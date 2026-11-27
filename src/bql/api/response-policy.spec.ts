import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it } from 'mocha';
import { Kind } from 'graphql';
import type { Connection, Protocol } from 'puppeteer-core';
import { BQLBrowserAPI } from '@browserless.io/browserless';
import { subscriptionResolvers } from '../schema/resolvers/subscription.js';

class CDP extends EventEmitter {
  calls: string[] = [];
  handler?: (method: string) => unknown;
  url() {
    return 'ws://localhost/devtools/page/policy';
  }
  async send(method: string) {
    this.calls.push(method);
    return this.handler?.(method) ?? {};
  }
  dispose() {}
}

class PolicyAPI extends BQLBrowserAPI {
  client = new CDP();
  denied = new Set<string>();
  throws = false;
  constructor() {
    super({
      browser: {} as any,
      config: {} as any,
      logger: { error() {} } as any,
      req: {} as any,
      blockConsentModals: false,
    });
    this.mainCDP = this.client as unknown as Connection;
    this.browserCDP = this.client as unknown as Connection;
  }
  setup() {
    return this.setupTarget(this.mainCDP, 'page');
  }
  reset() {
    (this as any).resetNetwork();
  }
  protected override allowResponseBody(
    event: Protocol.Network.ResponseReceivedEvent,
  ) {
    if (this.throws) throw new Error('policy failed');
    return !this.denied.has(event.response.url);
  }
  respond(requestId: string, url: string, hasExtraInfo = false) {
    this.client.emit('Network.requestWillBeSent', {
      requestId,
      request: { url, method: 'GET', headers: {} },
      type: 'Image',
    });
    this.client.emit('Network.responseReceived', {
      requestId,
      response: { url, status: 200, statusText: 'OK', headers: {} },
      type: 'Image',
      hasExtraInfo,
    });
  }
  bodyReads() {
    return this.client.calls.filter((m) => m === 'Network.getResponseBody')
      .length;
  }
}

const DENIED = 'https://denied.example/pixel';
const ALLOWED = 'https://allowed.example/pixel';

it('a denied response keeps metadata, ExtraInfo status and skips every body read', async () => {
  const api = new PolicyAPI();
  api.denied.add(DENIED);
  api.client.handler = () => ({ body: 'secret', base64Encoded: false });
  await api.setup();
  const events = api.streamEvents<any>('response');
  const next = events.next();
  api.respond('r', DENIED, true);
  api.client.emit('Network.responseReceivedExtraInfo', {
    requestId: 'r',
    statusCode: 304,
    headers: {},
  });
  const published = (await next).value;
  assert.equal(published.status, 304);
  assert.equal(published.bodyDenied, true);
  api.client.emit('Network.loadingFinished', { requestId: 'r' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await api.getResponseBody('r', 100), null);
  assert.equal(api.bodyReads(), 0, 'no eager or lazy CDP body read');
  await events.return(undefined);
  await api.close();
});

it('a denial pushed out of the bounded list stays withheld, before and after reset', async () => {
  const api = new PolicyAPI();
  api.client.handler = () => ({ body: 'secret', base64Encoded: false });
  await api.setup();
  for (let i = 0; i <= 1000; i++) {
    const url = `${DENIED}/${i}`;
    api.denied.add(url);
    api.respond(`d${i}`, url);
  }
  assert.equal(await api.getResponseBody('d0', 100), null);
  api.reset();
  assert.equal(await api.getResponseBody('d0', 100), null);
  assert.equal(api.bodyReads(), 0, 'no CDP body read for an aged-out denial');
  await api.close();
});

it('a failing policy withholds the body', async () => {
  const api = new PolicyAPI();
  api.throws = true;
  api.client.handler = () => ({ body: 'secret', base64Encoded: false });
  await api.setup();
  api.respond('r', ALLOWED);
  api.client.emit('Network.loadingFinished', { requestId: 'r' });
  assert.equal(await api.getResponseBody('r', 100), null);
  assert.equal(api.bodyReads(), 0);
  await api.close();
});

it('a denial survives a navigation reset until an allowed response reuses the ID', async () => {
  const api = new PolicyAPI();
  api.denied.add(DENIED);
  api.client.handler = () => ({ body: 'fresh', base64Encoded: false });
  await api.setup();
  api.respond('r', DENIED);
  api.reset();
  assert.equal(await api.getResponseBody('r', 100), null);
  assert.equal(api.bodyReads(), 0);
  api.respond('r', ALLOWED);
  api.client.emit('Network.loadingFinished', { requestId: 'r' });
  assert.deepEqual(await api.getResponseBody('r', 100), {
    body: 'fresh',
    base64Encoded: false,
  });
  await api.close();
});

it('with a policy, an untracked ID is never read from CDP, before or after a denial and reset', async () => {
  const api = new PolicyAPI();
  api.denied.add(DENIED);
  api.client.handler = () => ({ body: 'secret', base64Encoded: false });
  await api.setup();
  assert.equal(await api.getResponseBody('r', 1000), null);
  api.respond('r', DENIED);
  api.reset();
  assert.equal(await api.getResponseBody('r', 1000), null);
  assert.equal(api.bodyReads(), 0);
  await api.close();
});

it('queued subscription consumers carry the denial across reset and ID reuse', async () => {
  const api = new PolicyAPI();
  api.denied.add(DENIED);
  api.client.handler = () => ({ body: 'reused', base64Encoded: false });
  await api.setup();
  const info = {
    fieldNodes: [
      {
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: [{ kind: Kind.FIELD, name: { value: 'body' } }],
        },
      },
    ],
    fragments: {},
  };
  const iterator: any = await subscriptionResolvers.response(
    undefined,
    {},
    { getBrowser: async () => api, onClose: () => () => {} } as any,
    info as any,
  );
  const first = iterator.next();
  api.respond('r', DENIED);
  // The consumer resolves after the navigation reset and an allowed reuse.
  api.reset();
  api.respond('r', ALLOWED);
  api.client.emit('Network.loadingFinished', { requestId: 'r' });
  const denied = (await first).value.response;
  assert.equal(denied.url, DENIED);
  assert.equal(denied.body, null);
  assert.equal('bodyDenied' in denied, false);
  const allowed = (await iterator.next()).value.response;
  assert.equal(allowed.body, 'reused');
  await iterator.return();
  await api.close();
});
