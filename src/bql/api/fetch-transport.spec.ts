import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it } from 'mocha';
import type { Connection, Protocol } from 'puppeteer-core';
import { BQLBrowserAPI } from '@browserless.io/browserless';

class Client extends EventEmitter {
  replies: Array<{ method: string; params: any }> = [];
  url() {
    return 'ws://localhost/devtools/page/fixture';
  }
  async send(method: string, params: any = {}) {
    this.replies.push({ method, params });
    return {};
  }
  dispose() {}
}

type Handlers = {
  requestPaused(
    event: Protocol.Fetch.RequestPausedEvent,
    cdp: Connection,
  ): Promise<boolean>;
  authRequired(
    event: Protocol.Fetch.AuthRequiredEvent,
    cdp: Connection,
  ): Promise<boolean>;
};

class BorrowingAPI extends BQLBrowserAPI {
  control = new Client();
  owner = new Client();
  binding?: { handlers: Handlers; auth: boolean };
  constructor() {
    super({
      browser: {} as any,
      config: {
        getBlockedURLPatterns: () => ['https://blocked.example/'],
        getBlockedNetworkRanges: () => null,
        getSelfNavigationHosts: () => [],
      } as any,
      logger: { error() {} } as any,
      req: {} as any,
      blockConsentModals: false,
    });
    this.mainCDP = this.control as unknown as Connection;
    this.browserCDP = this.control as unknown as Connection;
  }
  setup() {
    return this.setupTarget(this.mainCDP, 'page');
  }
  protected async configureFetch(cdp: Connection) {
    await super.configureFetch(
      cdp,
      async (handlers: Handlers, auth: boolean) => {
        this.binding = { handlers, auth };
      },
    );
  }
  holdRequest(entered: () => void, gate: Promise<void>) {
    this.requestPipeline.use(async () => {
      entered();
      await gate;
      return { method: 'Fetch.fulfillRequest', params: { responseCode: 209 } };
    });
  }
  pause(url: string, requestId: string) {
    assert.ok(
      this.binding,
      'target setup must bind SDK dispatch to the selected transport',
    );
    return this.binding.handlers.requestPaused(
      {
        requestId,
        request: { url, method: 'GET', headers: {} },
        resourceType: 'XHR',
        frameId: 'fixture',
      } as Protocol.Fetch.RequestPausedEvent,
      this.owner as unknown as Connection,
    );
  }
  challenge(origin: string, requestId: string) {
    assert.ok(this.binding);
    return this.binding.handlers.authRequired(
      {
        requestId,
        request: { url: `${origin}/auth`, method: 'GET', headers: {} },
        resourceType: 'XHR',
        frameId: 'fixture',
        authChallenge: {
          source: 'Server',
          origin,
          scheme: 'basic',
          realm: 'fixture',
        },
      } as Protocol.Fetch.AuthRequiredEvent,
      this.owner as unknown as Connection,
    );
  }
}

it('delegated Fetch keeps SDK policy, rules and auth on the event owner through refresh', async () => {
  const api = new BorrowingAPI();
  try {
    await api.setup();
    await api.fulfill({ url: ['*'], body: 'sdk response', status: 207 });
    await api.pause('https://blocked.example/resource', 'denied');
    await api.pause('https://allowed.example/resource', 'allowed');
    assert.deepEqual(
      api.owner.replies.map((reply) => reply.method),
      ['Fetch.failRequest', 'Fetch.fulfillRequest'],
    );
    assert.equal(api.owner.replies[1].params.responseCode, 207);
    assert.equal(
      api.owner.replies[1].params.body,
      Buffer.from('sdk response').toString('base64'),
    );
    await api.authenticate({
      username: 'fixture',
      password: 'secret',
      origin: 'https://allowed.example',
    });
    assert.equal(api.binding?.auth, true);
    await api.pause('https://allowed.example/auth', 'auth');
    await api.challenge('https://allowed.example', 'auth');
    await api.challenge('https://allowed.example', 'auth');
    await api.pause('https://other.example/auth', 'other');
    await api.challenge('https://other.example', 'other');
    assert.deepEqual(
      api.owner.replies
        .filter((reply) => reply.method === 'Fetch.continueWithAuth')
        .map((reply) => reply.params.authChallengeResponse),
      [
        {
          response: 'ProvideCredentials',
          username: 'fixture',
          password: 'secret',
        },
        { response: 'CancelAuth' },
        { response: 'CancelAuth' },
      ],
    );
    assert.equal(
      api.control.replies.some((reply) => reply.method.startsWith('Fetch.')),
      false,
    );
    // A persistent transport can outlive SDK close. Saved callbacks cannot revive it.
    await api.close();
    const replies = api.owner.replies.length;
    assert.equal(
      await api.pause('https://allowed.example/late', 'late'),
      false,
    );
    assert.equal(await api.challenge('https://allowed.example', 'late'), false);
    assert.equal(api.owner.replies.length, replies);
  } finally {
    await api.close();
  }
});

it('delegated dispatch cannot publish an API response after close during an awaited handler', async () => {
  const api = new BorrowingAPI();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    await api.setup();
    api.holdRequest(entered, gate);
    const pending = api.pause('https://allowed.example/slow', 'slow');
    await waiting;
    await api.close();
    release();
    assert.equal(await pending, false);
    assert.deepEqual(api.owner.replies, []);
  } finally {
    release();
    await api.close();
  }
});
