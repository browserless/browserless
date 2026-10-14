import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it as test } from 'mocha';
import { runInNewContext } from 'node:vm';
import Sinon from 'sinon';
import { BQLBrowserAPI } from './browser-api.js';
import { CDPSessionEvent } from 'puppeteer-core/internal/api/CDPSession.js';
import { BadRequest, Timeout } from '../../utils.js';

class CDP extends EventEmitter {
  calls: Array<{ method: string; params: any }> = [];
  value: any = true;
  handler?: (method: string, params: any) => any;
  async send(method: string, params: any = {}) {
    this.calls.push({ method, params });
    return this.handler?.(method, params) ?? { result: { value: this.value } };
  }
  _closed = false;
  dispose() {
    this._closed = true;
    this.emit(CDPSessionEvent.Disconnected);
  }
}

class API extends BQLBrowserAPI {
  constructor(readonly client = new CDP()) {
    super({
      browser: {} as any,
      config: {} as any,
      logger: {} as any,
      req: {} as any,
      blockConsentModals: false,
    });
    this.mainCDP = client as any;
    this.browserCDP = client as any;
  }
  async setup() {
    await this.setupTarget(this.mainCDP, 'page');
  }
  use(handler: Parameters<typeof this.requestPipeline.use>[0]) {
    return this.requestPipeline.use(handler);
  }
  listeners(event: string) {
    return this.events.listenerCount(event);
  }
}

test('evaluate returns primitive values and surfaces script exceptions', async () => {
  const api = new API();
  api.client.value = 42;
  assert.equal((await api.evaluate({ content: '40 + 2' })).value, 42);
  assert.match(api.client.calls[0].params.expression, /return \(40 \+ 2\)/);
  api.client.handler = () => ({
    exceptionDetails: {
      text: 'failed',
      exception: { description: 'script failed' },
    },
  });
  await assert.rejects(
    api.evaluate({ content: 'throw new Error()' }),
    /script failed/,
  );
});

test('deep selectors are rejected before CDP dispatch', async () => {
  const api = new API();
  await assert.rejects(
    api.querySelector({ selector: '< iframe button', visible: false }),
    /not supported/,
  );
  assert.equal(api.client.calls.length, 0);
});

test('target setup can defer Runtime while console capture enables it on demand', async () => {
  class DeferredRuntime extends API {
    protected override async setupRuntime() {}
  }
  const api = new DeferredRuntime();
  await api.setup();
  assert.equal(
    api.client.calls.some((call) => call.method === 'Runtime.enable'),
    false,
  );
  await api.ensureConsoleCapture();
  assert.equal(
    api.client.calls.some((call) => call.method === 'Runtime.enable'),
    true,
  );
  await api.close();
});

test('pre-rule interception stays behind destination policy', async () => {
  class BeforeRules extends API {
    protected override async beforeRequestRules() {
      return {
        method: 'Fetch.fulfillRequest' as const,
        params: { responseCode: 204 },
      };
    }
    blockDestinations() {
      Object.assign(this.config, {
        getBlockedURLPatterns: () => ['https://'],
        getBlockedNetworkRanges: () => null,
        getSelfNavigationHosts: () => [],
      });
    }
  }
  const api = new BeforeRules();
  await api.setup();
  await api.reject({ enabled: true, url: ['*'] });
  api.client.emit('Fetch.requestPaused', {
    requestId: 'r',
    request: { url: 'https://example.com/', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(api.client.calls.at(-1)?.method, 'Fetch.fulfillRequest');
  api.blockDestinations();
  api.client.emit('Fetch.requestPaused', {
    requestId: 's',
    request: { url: 'https://example.com/', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(api.client.calls.at(-1)?.method, 'Fetch.failRequest');
  for (const response of [
    { responseStatusCode: 302 },
    { responseErrorReason: 'Failed' },
  ]) {
    api.client.emit('Fetch.requestPaused', {
      requestId: 'response',
      request: { url: 'https://example.com/', method: 'GET' },
      resourceType: 'Document',
      ...response,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(api.client.calls.at(-1)?.method, 'Fetch.continueRequest');
  }
  await api.close();
});

test('navigation listeners precede dispatch and return document metadata', async () => {
  const api = new API();
  api.client.handler = (method) => {
    if (method === 'Page.navigate') {
      api.client.emit('Network.responseReceived', {
        type: 'Document',
        loaderId: 'new',
        response: {
          url: 'https://example.com/',
          status: 201,
          statusText: 'Created',
          remoteIPAddress: '127.0.0.1',
          remotePort: 443,
        },
      });
      api.client.emit('Page.frameNavigated', {
        frame: { id: 'main', loaderId: 'new', url: 'https://example.com/' },
      });
      api.client.emit('Page.lifecycleEvent', {
        frameId: 'main',
        loaderId: 'new',
        name: 'load',
      });
      return { frameId: 'main', loaderId: 'new' };
    }
    return undefined;
  };
  const result = await api.goto({ url: 'https://example.com/', timeout: 100 });
  assert.equal(result.status, 201);
  assert.equal(result.url, 'https://example.com/');
  assert.equal(api.client.listenerCount('Page.lifecycleEvent'), 0);
});

test('navigation ignores old documents and removes listeners on timeout', async () => {
  const api = new API();
  const waiting = api.waitForNavigation('load', 10);
  api.client.emit('Page.lifecycleEvent', {
    frameId: 'main',
    loaderId: 'old',
    name: 'load',
  });
  await assert.rejects(waiting, /timed out/);
  assert.equal(api.client.listenerCount('Page.lifecycleEvent'), 0);
});

test('cached history restores settle without replayed lifecycle events', async () => {
  const api = new API();
  const waits = ['load', 'domContentLoaded', 'networkIdle'];
  const waiting = api.waitForNavigation(waits, 20);
  api.client.emit('Page.frameNavigated', {
    type: 'BackForwardCacheRestore',
    frame: {
      id: 'main',
      loaderId: 'cached',
      url: 'https://example.com/cached',
    },
  });
  assert.equal((await waiting).url, 'https://example.com/cached');
  assert.equal(api.client.listenerCount('Page.lifecycleEvent'), 0);
  const ordinary = api.waitForNavigation(waits, 20);
  api.client.emit('Page.frameNavigated', {
    type: 'Navigation',
    frame: { id: 'main', loaderId: 'new', url: 'https://example.com/new' },
  });
  await assert.rejects(ordinary, Timeout);
});

test('PDF document responses settle navigation without page lifecycle events', async () => {
  const api = new API();
  api.client.handler = (method) =>
    method === 'Page.getFrameTree'
      ? { frameTree: { frame: { id: 'main' } } }
      : undefined;
  await api.setup();
  const waiting = api.waitForNavigation('load', 20);
  api.client.emit('Network.responseReceived', {
    type: 'Document',
    frameId: 'main',
    loaderId: 'pdf',
    response: {
      url: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
      status: 200,
      statusText: 'OK',
    },
  });
  const result = await waiting;
  assert.equal(result.url, 'https://example.com/file.pdf');
  assert.equal(result.status, 200);
  const child = api.waitForNavigation('load', 20);
  api.client.emit('Network.responseReceived', {
    type: 'Document',
    frameId: 'child',
    loaderId: 'child-pdf',
    response: {
      url: 'https://example.com/child.pdf',
      mimeType: 'application/pdf',
      status: 200,
    },
  });
  await assert.rejects(child, /timed out/);
  await api.close();
});

test('strict idle waits for pending first bytes and transfer silence within its grace', async () => {
  const clock = Sinon.useFakeTimers();
  const api = new API();
  try {
    await api.setup();
    api.client.emit('Network.requestWillBeSent', {
      requestId: 'image',
      loaderId: 'new',
      type: 'Image',
      request: { url: 'https://example.com/image', method: 'GET' },
    });
    let finished = false;
    const waiting = api
      .waitForNavigation('networkIdle', 10_000)
      .then((result) => {
        finished = true;
        return result;
      });
    api.client.emit('Page.frameNavigated', {
      frame: { id: 'main', loaderId: 'new', url: 'https://example.com/' },
    });
    api.client.emit('Page.lifecycleEvent', {
      frameId: 'main',
      loaderId: 'new',
      name: 'networkAlmostIdle',
    });
    await clock.tickAsync(1500);
    assert.equal(finished, false);
    api.client.emit('Network.loadingFinished', { requestId: 'image' });
    await clock.tickAsync(900);
    api.client.emit('Network.dataReceived', {
      requestId: 'stream',
      dataLength: 10,
    });
    await clock.tickAsync(900);
    assert.equal(finished, false);
    await clock.tickAsync(100);
    assert.equal(finished, true);
    assert.equal((await waiting).time, 3400);
  } finally {
    await api.close();
    clock.restore();
  }
});

test('strict idle grace resets on a new document and remains bounded for stalled requests', async () => {
  const clock = Sinon.useFakeTimers();
  const api = new API();
  try {
    await api.setup();
    api.client.emit('Network.requestWillBeSent', {
      requestId: 'stalled',
      loaderId: 'old',
      type: 'Fetch',
      request: { url: 'https://example.com/poll', method: 'GET' },
    });
    let finished = false;
    const waiting = api
      .waitForNavigation('networkIdle', 10_000)
      .then((result) => {
        finished = true;
        return result;
      });
    const document = (loaderId: string) => {
      api.client.emit('Page.frameNavigated', {
        frame: { id: 'main', loaderId, url: `https://example.com/${loaderId}` },
      });
      api.client.emit('Page.lifecycleEvent', {
        frameId: 'main',
        loaderId,
        name: 'networkAlmostIdle',
      });
    };
    document('old');
    await clock.tickAsync(4000);
    document('new');
    await clock.tickAsync(2000);
    assert.equal(finished, false);
    await clock.tickAsync(1000);
    assert.equal((await waiting).url, 'https://example.com/new');
    assert.equal(clock.countTimers(), 0);
  } finally {
    await api.close();
    clock.restore();
  }
});

test('ordered Fetch dispatcher sends exactly one terminal action', async () => {
  const api = new API();
  await api.setup();
  await api.reject({ enabled: true, url: ['*blocked*'], operator: 'or' });
  await api.fulfill({
    url: ['*'],
    operator: 'or',
    body: 'hello',
    contentType: 'text/plain',
  });
  api.client.emit('Fetch.requestPaused', {
    requestId: 'r',
    request: { url: 'https://example.com/blocked', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    api.client.calls
      .filter((c) => /Fetch\.(fail|fulfill|continue)Request/.test(c.method))
      .map((c) => c.method),
    ['Fetch.failRequest'],
  );
  await api.reject({ enabled: false, operator: 'or' });
  api.client.emit('Fetch.requestPaused', {
    requestId: 's',
    request: { url: 'https://example.com/', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const fulfilled = api.client.calls.find(
    (c) => c.method === 'Fetch.fulfillRequest',
  )!;
  assert.equal(fulfilled.params.body, Buffer.from('hello').toString('base64'));
});

test('raw coordinate click uses CDP input and preserves result shape', async () => {
  const api = new API();
  const result = await api.click({
    x: 12,
    y: 34,
    wait: false,
    scroll: false,
    visible: false,
  });
  assert.equal(result.x, 12);
  assert.equal(result.y, 34);
  assert.deepEqual(
    api.client.calls.map((c) => c.params.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased'],
  );
});

test('captures use raw CDP and return base64 and size', async () => {
  const api = new API();
  api.client.handler = () => ({ data: 'aGVsbG8=' });
  assert.equal(
    (await api.screenshot({ options: { type: 'png' } })).base64,
    'aGVsbG8=',
  );
  assert.equal((await api.pdf({})).size, 5);
  assert.deepEqual(
    api.client.calls
      .filter(
        (c) =>
          c.method === 'Page.captureScreenshot' ||
          c.method === 'Page.printToPDF',
      )
      .map((c) => c.method),
    ['Page.captureScreenshot', 'Page.printToPDF'],
  );
});

test('capture retries once after document replacement but leaves a slow unchanged document alone', async () => {
  const clock = Sinon.useFakeTimers();
  try {
    for (const swapped of [false, true]) {
      const api = new API();
      let finish!: (value: { data: string }) => void;
      let count = 0;
      api.client.handler = (method) => {
        if (method === 'Page.captureScreenshot') {
          if (++count === 1)
            return new Promise((resolve) => {
              finish = resolve;
            });
          return { data: 'cmV0cnk=' };
        }
        return undefined;
      };
      const pending = api.screenshot({ options: { timeout: 20_000 } });
      await clock.tickAsync(10);
      api.client.emit('Page.frameNavigated', {
        frame: {
          id: swapped ? 'main' : 'child',
          parentId: swapped ? undefined : 'main',
          loaderId: 'new',
          url: 'https://example.com/',
        },
      });
      await clock.tickAsync(5000);
      if (swapped) {
        await clock.tickAsync(5000);
        assert.equal((await pending).base64, 'cmV0cnk=');
        assert.equal(count, 2);
      } else {
        assert.equal(count, 1);
        finish({ data: 'c2xvdw==' });
        assert.equal((await pending).base64, 'c2xvdw==');
      }
      assert.equal(api.client.listenerCount('Page.frameNavigated'), 0);
      await api.close();
    }
  } finally {
    clock.restore();
  }
});

test('capture does not retry a replaced document after its deadline', async () => {
  const clock = Sinon.useFakeTimers();
  const api = new API();
  try {
    api.client.handler = (method) =>
      method === 'Page.captureScreenshot' ? new Promise(() => {}) : undefined;
    const pending = assert.rejects(
      api.screenshot({ options: { timeout: 200 } }),
      /Screenshot timed out/,
    );
    await clock.tickAsync(10);
    api.client.emit('Page.frameNavigated', {
      frame: { id: 'main', loaderId: 'new', url: 'https://example.com/' },
    });
    await clock.tickAsync(190);
    await pending;
    assert.equal(
      api.client.calls.filter((c) => c.method === 'Page.captureScreenshot')
        .length,
      1,
    );
    assert.equal(api.client.listenerCount('Page.frameNavigated'), 0);
    assert.equal(clock.countTimers(), 0);
  } finally {
    await api.close();
    clock.restore();
  }
});

test('screenshot clips retain relative offsets and scale and reject empty intersections', async () => {
  const api = new API();
  api.client.value = { x: 20, y: 30, width: 100, height: 80 };
  api.client.handler = (method) =>
    method === 'Page.getFrameTree'
      ? { frameTree: { frame: { id: 'main' } } }
      : method === 'Page.getLayoutMetrics'
        ? {
            cssVisualViewport: {
              pageX: 10,
              pageY: 15,
              clientWidth: 300,
              clientHeight: 200,
            },
          }
        : method === 'Page.captureScreenshot'
          ? { data: 'aGVsbG8=' }
          : undefined;
  await api.screenshot({
    selector: 'button',
    options: { clip: { x: 5, y: 7, width: 40, height: 20 } },
  });
  assert.deepEqual(
    api.client.calls.find((c) => c.method === 'Page.captureScreenshot')?.params
      .clip,
    { x: 35, y: 52, width: 40, height: 20, scale: 1 },
  );
  await assert.rejects(
    api.screenshot({
      options: {
        clip: { x: 900, y: 900, width: 40, height: 20 },
        captureBeyondViewport: false,
      },
    }),
    BadRequest,
  );
  await api.screenshot({
    options: { clip: { x: 2, y: 3, width: 40, height: 20, scale: 2 } },
  });
  assert.equal(
    api.client.calls.filter((c) => c.method === 'Page.captureScreenshot').at(-1)
      ?.params.clip.scale,
    2,
  );
});

test('preferences treats null and zero as reads and rejects invalid viewport dimensions', async () => {
  const api = new API();
  api.preferences({ timeout: 1250 });
  assert.equal(api.preferences({ timeout: 0 }).timeout, 1250);
  assert.equal(api.preferences({ timeout: null }).timeout, 1250);
  await assert.rejects(api.viewport({ width: 0, height: 10 }), /dimensions/);
});

test('invalid primitive arguments keep their customer-input error classification', async () => {
  class LoadedScript extends API {
    protected override async fetchScript() {
      return '42';
    }
  }
  const api = new LoadedScript();
  api.client.value = 42;
  assert.equal(
    (await api.evaluate({ content: null, url: 'https://example.com/script' }))
      .value,
    42,
  );
  await assert.rejects(api.evaluate({ content: '' }), BadRequest);
  await assert.rejects(api.addScriptTag({ content: '' }), BadRequest);
  await assert.rejects(api.addStyleTag({ content: '' }), BadRequest);
  await assert.rejects(
    api.waitForSelector({ selector: 'input', visible: true, hidden: true }),
    BadRequest,
  );
  await assert.rejects(api.fulfill({ status: 200 }), BadRequest);
  await api.fulfill({ url: [], status: 200 });
  assert.throws(() => api.preferences({ timeout: -1 }), BadRequest);
});

test('commit navigation settles on the new main document without load', async () => {
  const api = new API();
  const waiting = api.waitForNavigation('commit', 20);
  api.client.emit('Page.frameNavigated', {
    frame: { id: 'main', loaderId: 'new', url: 'https://example.com/' },
  });
  assert.equal((await waiting).url, 'https://example.com/');
});

test('response waits release body listeners after the shared timeout budget', async () => {
  const api = new API();
  await api.setup();
  api.client.emit('Network.requestWillBeSent', {
    requestId: 'r',
    request: { url: 'https://example.com/', method: 'GET', headers: {} },
    type: 'Document',
  });
  api.client.emit('Network.responseReceived', {
    requestId: 'r',
    response: { url: 'https://example.com/', status: 200, headers: {} },
    type: 'Document',
  });
  const result = await api.response({ wait: true, timeout: 10, url: ['*'] });
  assert.equal(result?.[0].body, null);
  assert.equal(api.listeners('body'), 0);
});

test('Fetch handler failure fails closed rather than leaving a paused request', async () => {
  const api = new API();
  await api.setup();
  api.use(() => {
    throw new Error('handler failed');
  });
  api.client.emit('Fetch.requestPaused', {
    requestId: 'r',
    request: { url: 'https://example.com/', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    api.client.calls.filter((c) => c.method === 'Fetch.failRequest').length,
    1,
  );
});

test('CSS queries enter open shadow roots without touching frame documents', async () => {
  const api = new API();
  const button = {
    id: 'shadow-button',
    childElementCount: 0,
    className: '',
    innerHTML: 'Save',
    innerText: 'Save',
    localName: 'button',
    outerHTML: '<button>Save</button>',
  };
  const host = {
    shadowRoot: {
      querySelectorAll: (selector: string) =>
        selector === 'button' ? [button] : [],
    },
  };
  const frame = {
    get contentDocument() {
      throw new Error('Unexpected frame access');
    },
  };
  const document = {
    querySelectorAll: (selector: string) =>
      selector === '*' ? [host, frame] : [],
  };
  api.client.handler = async (method, params) =>
    method === 'Runtime.evaluate'
      ? {
          result: {
            value: await runInNewContext(params.expression, { document }),
          },
        }
      : undefined;
  assert.equal(
    (await api.querySelector({ selector: 'button' })).id,
    'shadow-button',
  );
  assert.equal(await api.querySelectorAll({ selector: '.missing' }), null);
});

test('content preserves the status contract and evaluates on the supplied target', async () => {
  const api = new API();
  const secondary = new CDP();
  secondary.handler = (method, params) => {
    if (method === 'Page.getFrameTree')
      return {
        frameTree: {
          frame: { id: 'secondary', url: 'https://example.com/secondary' },
        },
      };
    if (method === 'Page.setDocumentContent')
      secondary.emit('Page.lifecycleEvent', {
        frameId: 'secondary',
        loaderId: 'new',
        name: 'init',
      });
    return method === 'Runtime.evaluate'
      ? {
          result: {
            value: params.expression.includes('location.href')
              ? 'https://example.com/secondary'
              : true,
          },
        }
      : {};
  };
  const result = await api.content({
    html: '<h1>Hello</h1>',
    cdp: secondary as any,
    waitUntil: [],
  });
  assert.equal(result.status, 200);
  assert.equal(result.url, 'https://example.com/secondary');
  assert.equal(api.client.calls.length, 0);
});

test('PDF accepts primitive marginTop and waits for requested fonts', async () => {
  const api = new API();
  api.client.handler = (method) =>
    method === 'Page.printToPDF'
      ? { data: 'aGVsbG8=' }
      : { result: { value: true } };
  await api.pdf({ options: { marginTop: '1in', waitForFonts: true } });
  const print = api.client.calls.find((c) => c.method === 'Page.printToPDF')!;
  assert.equal(print.params.marginTop, 1);
  assert.ok(
    api.client.calls.find(
      (c) =>
        c.method === 'Runtime.evaluate' &&
        c.params.expression.includes('document.fonts.ready'),
    ),
  );
});

test('cookie partition keys map sourceOrigin and preserve the result shape', async () => {
  const api = new API();
  api.client.handler = (method) =>
    method === 'Network.getCookies'
      ? {
          cookies: [
            {
              name: 'session',
              value: 'test',
              domain: 'example.com',
              path: '/',
              expires: -1,
              secure: false,
              httpOnly: false,
            },
          ],
        }
      : {
          result: {
            value: {
              url: 'https://example.com/',
              domain: 'example.com',
              path: '/',
            },
          },
        };
  const result = await api.cookies({
    cookies: [
      {
        name: 'session',
        value: 'test',
        url: 'https://example.com/',
        partitionKey: { sourceOrigin: 'https://example.com/' },
      },
    ],
  });
  assert.equal(
    api.client.calls.find((c) => c.method === 'Network.setCookies')!.params
      .cookies[0].partitionKey.topLevelSite,
    'https://example.com/',
  );
  assert.equal(result.cookies[0].sameSite, 'Lax');
  assert.equal(result.cookies[0].url, 'https://example.com/');
});

test('close cancels network and navigation waits without retaining listeners', async () => {
  const api = new API();
  const request = api.waitForRequest({ urls: ['*'], timeout: 100 });
  const navigation = api.waitForNavigation('load', 100);
  const idle = api.waitForNetworkIdle({ idleTime: 50, timeout: 100 });
  const assertions = [
    assert.rejects(request, /closed/),
    assert.rejects(navigation, /no longer running/),
    assert.rejects(idle, /closed/),
  ];
  await api.close();
  await Promise.all(assertions);
  assert.equal(api.client.listenerCount('Page.frameNavigated'), 0);
  assert.equal(api.listeners('close'), 0);
});

test('and filters require every supplied pattern, including patterns in one field', async () => {
  const api = new API();
  await api.setup();
  api.client.emit('Network.requestWillBeSent', {
    requestId: 'r',
    request: { url: 'https://example.com/path', method: 'GET', headers: {} },
    type: 'Document',
  });
  assert.equal(
    api.hasMadeRequest({
      urls: ['*example.com*', '*missing*'],
      operator: 'and',
    }),
    null,
  );
  assert.equal(
    api.hasMadeRequest({ urls: ['*example.com*', '*missing*'], operator: 'or' })
      ?.length,
    1,
  );
});

test('typing dispatches key events so native keyboard listeners receive text', async () => {
  const api = new API();
  api.client.value = { x: 1, y: 2, width: 10, height: 10 };
  await api.type({ selector: 'input', text: 'a\n' });
  const keys = api.client.calls.filter(
    (c) => c.method === 'Input.dispatchKeyEvent',
  );
  assert.deepEqual(
    keys.map((c) => c.params.type),
    ['keyDown', 'keyUp', 'keyDown', 'keyUp'],
  );
  assert.equal(keys[2].params.key, 'Enter');
});

test('html with a selector returns its children rather than its wrapper', async () => {
  const api = new API();
  const node = {
    childNodes: [{ markup: '<b>Hello</b>' }],
    outerHTML: '<section><b>Hello</b></section>',
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  };
  const document = {
    querySelectorAll: (selector: string) =>
      selector === 'section' ? [node] : [],
    documentElement: {},
  };
  class XMLSerializer {
    serializeToString(item: { markup: string }) {
      return item.markup;
    }
  }
  api.client.handler = async (method, params) =>
    method === 'Runtime.evaluate'
      ? {
          result: {
            value: await runInNewContext(params.expression, {
              document,
              XMLSerializer,
              getComputedStyle: () => ({}),
            }),
          },
        }
      : undefined;
  assert.equal((await api.html({ selector: 'section' })).html, '<b>Hello</b>');
});

test('reject rules have priority over earlier fulfill rules', async () => {
  const api = new API();
  await api.setup();
  await api.fulfill({ url: ['*'], body: 'fallback' });
  await api.reject({ enabled: true, url: ['*blocked*'] });
  api.client.emit('Fetch.requestPaused', {
    requestId: 'r',
    request: { url: 'https://example.com/blocked', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    api.client.calls.filter((c) => c.method === 'Fetch.failRequest').length,
    1,
  );
});

test('screenshot validates quality and clip before capture', async () => {
  const api = new API();
  await assert.rejects(
    api.screenshot({ options: { type: 'png', quality: 50 } }),
    /quality/,
  );
  await assert.rejects(
    api.screenshot({ options: { clip: { x: 0, y: 0, width: 0, height: 1 } } }),
    /clip/,
  );
  await assert.rejects(
    api.screenshot({ selector: '#x', options: { fullPage: true } }),
    /exclusive/,
  );
  assert.equal(api.client.calls.length, 0);
});

test('capture timeout restores transparent background overrides', async () => {
  const api = new API();
  api.client.handler = (method) =>
    method === 'Page.captureScreenshot' ? new Promise(() => {}) : {};
  await assert.rejects(
    api.screenshot({ options: { omitBackground: true, timeout: 10 } }),
    /timed out/,
  );
  assert.equal(
    api.client.calls.at(-1)?.method,
    'Emulation.setDefaultBackgroundColorOverride',
  );
  assert.deepEqual(api.client.calls.at(-1)?.params, {});
});

test('capture and readback hooks run before CDP read operations', async () => {
  class Hooks extends API {
    readonly sequence: string[] = [];
    protected override async beforeReadback() {
      this.sequence.push('read');
    }
    protected override async beforeCapture() {
      this.sequence.push('capture');
    }
    protected override async beforeNavigate() {
      this.sequence.push('before');
    }
    protected override async afterNavigate() {
      this.sequence.push('after');
    }
    protected override async onClose() {
      this.sequence.push('close');
    }
  }
  const api = new Hooks();
  api.client.handler = (method) =>
    method === 'Page.captureScreenshot'
      ? { data: 'aGVsbG8=' }
      : { result: { value: true } };
  await api.evaluate({ content: 'true' });
  await api.screenshot({});
  await api.close();
  assert.deepEqual(api.sequence, ['read', 'capture', 'close']);
});

test('invalid and excessive network regexes are rejected when registered', async () => {
  const api = new API();
  await assert.rejects(api.reject({ enabled: true, regex: ['('] }), /regex/i);
  await assert.rejects(
    api.fulfill({ regex: ['x'.repeat(201)], body: 'test' }),
    /regex/i,
  );
  await assert.rejects(
    api.reject({ enabled: true, regex: ['(a+)+'] }),
    /regex/i,
  );
});

test('intentional document rejects return null status instead of navigate errors', async () => {
  const api = new API();
  await api.reject({ enabled: true, url: ['*blocked*'] });
  api.client.handler = (method) => {
    if (method !== 'Page.navigate') return undefined;
    api.client.emit('Page.frameNavigated', {
      frame: {
        id: 'main',
        loaderId: 'new',
        url: 'chrome-error://chromewebdata/',
      },
    });
    api.client.emit('Page.lifecycleEvent', {
      frameId: 'main',
      loaderId: 'new',
      name: 'load',
    });
    return { errorText: 'net::ERR_ABORTED' };
  };
  const result = await api.goto({ url: 'https://example.com/blocked' });
  assert.equal(result.status, null);
  assert.equal(result.rejected, true);
});

test('content waits for the new document and every requested lifecycle event', async () => {
  const api = new API();
  api.client.handler = (method) => {
    if (method === 'Page.getFrameTree')
      return {
        frameTree: {
          frame: { id: 'main', loaderId: 'same', url: 'about:blank' },
        },
      };
    if (method === 'Page.setDocumentContent') {
      api.client.emit('Page.lifecycleEvent', {
        frameId: 'main',
        loaderId: 'same',
        name: 'networkIdle',
      });
      api.client.emit('Page.lifecycleEvent', {
        frameId: 'main',
        loaderId: 'same',
        name: 'init',
      });
      api.client.emit('Page.lifecycleEvent', {
        frameId: 'main',
        loaderId: 'same',
        name: 'load',
      });
    }
    return { result: { value: 'about:blank' } };
  };
  let settled = false;
  const content = api
    .content({
      html: '<h1>new</h1>',
      waitUntil: ['load', 'networkIdle'],
      timeout: 100,
    })
    .then((result) => {
      settled = true;
      return result;
    });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  api.client.emit('Page.lifecycleEvent', {
    frameId: 'main',
    loaderId: 'same',
    name: 'networkIdle',
  });
  assert.equal((await content).status, 200);
});

test('event streams deliver network payloads and cancellation wakes idle readers', async () => {
  const api = new API();
  await api.setup();
  const events = api.streamEvents<{ url: string }>('request');
  api.client.emit('Network.requestWillBeSent', {
    requestId: 'r',
    request: { url: 'https://example.com/data', method: 'POST', headers: {} },
    type: 'Fetch',
  });
  assert.equal((await events.next()).value.url, 'https://example.com/data');
  const idle = events.next();
  await events.return(undefined);
  assert.equal((await idle).done, true);
  assert.equal(api.listeners('request'), 0);
  const neverRead = api.streamEvents('request');
  await neverRead.return(undefined);
  assert.equal(api.listeners('request'), 0);
  const closing = api.streamEvents('response');
  const pending = closing.next();
  await api.close();
  assert.equal((await pending).done, true);
});

test('console capture emits serializable arguments and exception locations once', async () => {
  const api = new API();
  await api.setup();
  await api.ensureConsoleCapture();
  await api.ensureConsoleCapture();
  const events = api.streamEvents<any>('console');
  api.client.emit('Runtime.consoleAPICalled', {
    type: 'warning',
    args: [
      { type: 'string', value: 'hello' },
      { type: 'number', value: 42 },
    ],
    stackTrace: {
      callFrames: [
        { url: 'https://example.com/', lineNumber: 3, columnNumber: 7 },
      ],
    },
  });
  const message = (await events.next()).value;
  assert.equal(message.type, 'warning');
  assert.equal(message.text, 'hello 42');
  assert.deepEqual(message.args, ['"hello"', '42']);
  assert.equal(message.location.lineNumber, 3);
  api.client.emit('Runtime.exceptionThrown', {
    exceptionDetails: {
      text: 'Uncaught',
      exception: { description: 'Error: failed' },
      lineNumber: 8,
      columnNumber: 2,
    },
  });
  assert.equal((await events.next()).value.text, 'Error: failed');
  await events.return(undefined);
  await api.close();
});

test('response bodies use the originating target after a window switch', async () => {
  const api = new API();
  await api.setup();
  api.client.handler = (method) =>
    method === 'Network.getResponseBody'
      ? { body: 'original', base64Encoded: false }
      : {};
  api.client.emit('Network.requestWillBeSent', {
    requestId: 'r',
    request: { url: 'https://example.com/data', method: 'GET', headers: {} },
    type: 'Fetch',
  });
  api.client.emit('Network.responseReceived', {
    requestId: 'r',
    response: { url: 'https://example.com/data', status: 200, headers: {} },
    type: 'Fetch',
  });
  const body = api.getResponseBody('r', 100);
  api.mainCDP = new CDP() as any;
  api.client.emit('Network.loadingFinished', { requestId: 'r' });
  assert.deepEqual(await body, { body: 'original', base64Encoded: false });
  api.client.handler = () => {
    throw new Error('Response data no longer available');
  };
  assert.deepEqual(await api.getResponseBody('r'), {
    body: 'original',
    base64Encoded: false,
  });
  await api.close();
});

test('response retention bounds bytes and entries while prioritizing documents', async () => {
  const api = new API();
  await api.setup();
  let available = true;
  const payloads = new Map<string, string>();
  api.client.handler = (method, params) => {
    if (method !== 'Network.getResponseBody') return {};
    if (!available) throw new Error('Body discarded');
    return { body: payloads.get(params.requestId) ?? '', base64Encoded: false };
  };
  const response = async (id: string, type: string, body: string) => {
    payloads.set(id, body);
    api.client.emit('Network.responseReceived', {
      requestId: id,
      type,
      response: { url: `https://example.com/${id}`, status: 200, headers: {} },
    });
    api.client.emit('Network.loadingFinished', { requestId: id });
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  await response('asset', 'Fetch', 'a'.repeat(6 * 1024 * 1024));
  await response('document', 'Document', 'd'.repeat(6 * 1024 * 1024));
  available = false;
  assert.equal(await api.getResponseBody('asset'), null);
  assert.equal(
    (await api.getResponseBody('document'))?.body.length,
    6 * 1024 * 1024,
  );
  available = true;
  await response('small', 'Fetch', 'kept');
  await response('oversized', 'Document', 'x'.repeat(10 * 1024 * 1024 + 1));
  for (let i = 0; i < 1001; i++) await response(`item-${i}`, 'Fetch', '');
  available = false;
  assert.equal(await api.getResponseBody('small'), null);
  assert.equal(await api.getResponseBody('oversized'), null);
  assert.equal(
    (await api.getResponseBody('document'))?.body.length,
    6 * 1024 * 1024,
  );
  assert.equal((await api.getResponseBody('item-1000'))?.body, '');
  await api.close();
});

test('response metadata pairs extra info across redirects in either arrival order', async () => {
  const api = new API();
  await api.setup();
  const emitResponse = (id: string, fromDiskCache = false) =>
    api.client.emit('Network.responseReceived', {
      requestId: id,
      type: 'Document',
      loaderId: id,
      hasExtraInfo: true,
      response: {
        url: `https://example.com/${id}`,
        status: 200,
        statusText: 'OK',
        headers: {},
        fromDiskCache,
      },
    });
  const extra = (id: string, statusCode: number) =>
    api.client.emit('Network.responseReceivedExtraInfo', {
      requestId: id,
      statusCode,
      headersText: `HTTP/1.1 ${statusCode} Network Status\r\n`,
      headers: {},
    });
  const redirect = (id: string) =>
    api.client.emit('Network.requestWillBeSent', {
      requestId: id,
      type: 'Document',
      redirectHasExtraInfo: true,
      redirectResponse: {},
      request: { url: `https://example.com/${id}`, method: 'GET', headers: {} },
    });
  const events = api.streamEvents<any>('response');
  extra('early', 301);
  redirect('early');
  extra('early', 304);
  emitResponse('early');
  assert.equal((await events.next()).value.status, 304);
  const navigation = api.waitForNavigation('commit', 100);
  redirect('late');
  emitResponse('late');
  api.client.emit('Page.frameNavigated', {
    frame: { id: 'main', loaderId: 'late', url: 'https://example.com/late' },
  });
  extra('late', 302);
  extra('late', 304);
  assert.equal((await navigation).status, 304);
  assert.equal((await events.next()).value.status, 304);
  assert.equal(api.hasReceivedResponse({ urls: ['*late'] })?.[0].status, 304);
  extra('cached', 304);
  emitResponse('cached', true);
  assert.equal((await events.next()).value.status, 200);
  await events.return(undefined);
  const fallback = api.waitForNavigation('commit', 10);
  emitResponse('missing');
  api.client.emit('Page.frameNavigated', {
    frame: {
      id: 'main',
      loaderId: 'missing',
      url: 'https://example.com/missing',
    },
  });
  assert.equal((await fallback).status, 200);
  const cancelled = api.waitForNavigation('commit', 0);
  emitResponse('closed');
  api.client.emit('Page.frameNavigated', {
    frame: {
      id: 'main',
      loaderId: 'closed',
      url: 'https://example.com/closed',
    },
  });
  const rejection = assert.rejects(cancelled, /no longer running/);
  await api.close();
  await rejection;
});

test('closing cancels readers while eager response capture is pending', async () => {
  const api = new API();
  await api.setup();
  let finish!: (value: any) => void;
  api.client.handler = (method) =>
    method === 'Network.getResponseBody'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : {};
  api.client.emit('Network.responseReceived', {
    requestId: 'pending',
    type: 'Fetch',
    response: { url: 'https://example.com/', status: 200, headers: {} },
  });
  api.client.emit('Network.loadingFinished', { requestId: 'pending' });
  const read = api.getResponseBody('pending', 0);
  await Promise.resolve();
  await api.close();
  assert.equal(await read, null);
  finish({ body: 'late', base64Encoded: false });
  await Promise.resolve();
  assert.equal(await api.getResponseBody('pending'), null);
  assert.equal(api.listeners('body'), 0);
});

test('extension request handlers cannot override core rejection rules', async () => {
  const api = new API();
  await api.setup();
  await api.reject({ enabled: true, url: ['*blocked*'] });
  api.use(() => ({ method: 'Fetch.continueRequest' }));
  api.client.emit('Fetch.requestPaused', {
    requestId: 'r',
    request: { url: 'https://example.com/blocked', method: 'GET' },
    resourceType: 'Document',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(api.client.calls.at(-1)?.method, 'Fetch.failRequest');
  await api.close();
});

test('closing during startup disposes late connections and prevents hooks from starting', async () => {
  let release!: () => void;
  let entered!: () => void;
  const connecting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disposed = 0;
  let started = false;
  const client = new CDP();
  client.dispose = () => {
    disposed++;
  };
  class StartingAPI extends BQLBrowserAPI {
    override async listPageTargets() {
      return [
        {
          id: 'page',
          type: 'page',
          title: '',
          url: 'about:blank',
          webSocketDebuggerUrl: 'ws://example.com/page',
        },
      ];
    }
    protected override async connect() {
      entered();
      await gate;
      return client as any;
    }
    protected override async onStart() {
      started = true;
    }
  }
  const api = new StartingAPI({
    browser: { wsEndpoint: () => 'ws://example.com/browser' } as any,
    config: {} as any,
    logger: {} as any,
    req: {} as any,
    blockConsentModals: false,
  });
  const startup = api.start();
  await connecting;
  await api.close();
  release();
  await assert.rejects(startup, /closed|no longer running/);
  assert.ok(disposed > 0);
  assert.equal(started, false);
});

test('bounding rectangles return null for absent elements without hiding evaluation failures', async () => {
  const api = new API();
  api.client.value = null;
  assert.equal(await api.getBoundingClientRect({ selector: '.missing' }), null);
  api.client.value = { x: 1, y: 2, width: 3, height: 4 };
  assert.equal(
    (await api.getBoundingClientRect({ selector: '.found' }))?.width,
    3,
  );
  api.client.handler = () => ({
    exceptionDetails: { text: 'Invalid selector' },
  });
  await assert.rejects(
    api.getBoundingClientRect({ selector: '[' }),
    /Invalid selector/,
  );
});

test('HTTP authentication is origin scoped and cancels repeated challenges', async () => {
  const api = new API();
  await api.setup();
  await api.authenticate({
    username: 'test-user',
    password: 'test-password',
    origin: 'https://example.com',
  });
  const challenge = (requestId: string, origin: string, source = 'Server') =>
    api.client.emit('Fetch.authRequired', {
      requestId,
      request: { url: origin + '/private' },
      authChallenge: { origin, source },
    });
  challenge('first', 'https://example.com');
  challenge('first', 'https://example.com');
  challenge('other', 'https://other.example.com');
  challenge('other-source', 'https://example.com', 'Proxy');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const results = api.client.calls
    .filter((call) => call.method === 'Fetch.continueWithAuth')
    .map((call) => call.params.authChallengeResponse);
  assert.deepEqual(results, [
    {
      response: 'ProvideCredentials',
      username: 'test-user',
      password: 'test-password',
    },
    { response: 'CancelAuth' },
    { response: 'CancelAuth' },
    { response: 'Default' },
  ]);
  await assert.rejects(
    api.authenticate({ username: 'x', password: 'x', origin: 'invalid' }),
    /Invalid HTTP origin/,
  );
  await api.close();
});

test('disconnect notifications distinguish active target loss, replacement and intentional close', async () => {
  const api = new API();
  api.browserCDP = new CDP() as any;
  await api.setup();
  let notifications = 0;
  const unsubscribe = api.onDisconnected(() => {
    notifications++;
  });
  unsubscribe();
  api.onDisconnected(() => {
    notifications++;
  });
  const replacement = new CDP();
  api.mainCDP = replacement as any;
  await api.setup();
  api.client.dispose();
  assert.equal(notifications, 0);
  assert.equal(api.hasErrored(), false);
  const stream = api.streamEvents('request');
  const pending = stream.next();
  replacement.dispose();
  assert.equal(notifications, 1);
  assert.equal(api.hasErrored(), true);
  assert.equal((await pending).done, true);
  await api.close();
  const intentional = new API();
  await intentional.setup();
  intentional.onDisconnected(() => {
    notifications++;
  });
  await intentional.close();
  assert.equal(notifications, 1);
});

test('readback policy leaves internal input evaluation available', async () => {
  class Restricted extends API {
    protected override async beforeReadback() {
      throw new Error('Readback denied');
    }
  }
  const api = new Restricted();
  api.client.value = { x: 1, y: 2, width: 10, height: 10 };
  await api.click({ selector: 'button' });
  await api.type({ selector: 'input', text: 'x' });
  await assert.rejects(
    api.evaluate({ content: 'document.body.innerText' }),
    /Readback denied/,
  );
  await assert.rejects(api.cookies(), /Readback denied/);
});

test('input honors a target selected by an overridden element resolver', async () => {
  const secondary = new CDP();
  class Targeted extends API {
    override async waitForSelector() {
      return { x: 2, y: 4, width: 10, height: 20, cdp: secondary as any };
    }
  }
  const api = new Targeted();
  const result = await api.click({ selector: 'button' });
  assert.equal(result.cdp, secondary);
  assert.equal(secondary.calls.at(-1)?.method, 'Input.dispatchMouseEvent');
  assert.equal(api.client.calls.length, 0);
});
