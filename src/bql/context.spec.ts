import assert from 'node:assert/strict';
import { BQLBrowserAPI } from './api/browser-api.js';
import { Context } from './context.js';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];

describe('BrowserQL context lifetime', () => {
  it('bridges disconnect listeners before startup and unsubscribes during teardown', async () => {
    let starts = 0;
    let notifications = 0;
    let unsubscriptions = 0;
    let notify = () => {};
    class API extends BQLBrowserAPI {
      async start() {
        starts++;
        notify();
      }
      async close() {
        notify();
      }
      onDisconnected(listener: () => void) {
        notify = listener;
        return () => {
          unsubscriptions++;
          notify = () => {};
        };
      }
    }
    const context = new Context(options, (options) => new API(options));
    const unregister = context.onDisconnected(() => {
      notifications++;
    });
    assert.equal(starts, 0);
    await context.getBrowser();
    assert.equal(notifications, 1);
    unregister();
    notify();
    assert.equal(notifications, 1);
    context.onDisconnected(() => {
      notifications++;
    });
    await context.close();
    assert.equal(notifications, 1);
    assert.equal(unsubscriptions, 1);
  });

  it('reports API failure without initializing a browser', async () => {
    let starts = 0;
    let failed = false;
    class API extends BQLBrowserAPI {
      override async start() {
        starts++;
      }
      override async close() {}
      override hasErrored() {
        return failed;
      }
    }
    const context = new Context(options, (options) => new API(options));
    assert.equal(context.hasErrored(), false);
    assert.equal(starts, 0);
    await context.getBrowser();
    failed = true;
    assert.equal(context.hasErrored(), true);
    await context.close();
  });

  it('shares initialization and closes exactly once even while initialization is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let starts = 0;
    let closes = 0;
    class API extends BQLBrowserAPI {
      override async start() {
        starts++;
        await gate;
      }
      override async close() {
        closes++;
      }
    }
    const context = new Context(options, (options) => new API(options));
    const a = context.getBrowser();
    const b = context.getBrowser();
    const closing = context.close();
    assert.equal(context.close(), closing);
    release();
    assert.equal(await a, await b);
    await closing;
    assert.equal(starts, 1);
    assert.equal(closes, 1);
    await assert.rejects(context.getBrowser(), /closed/);
  });

  it('cleans failed startup and does not create another API on a poisoned context', async () => {
    let closes = 0;
    class API extends BQLBrowserAPI {
      override async start() {
        throw new Error('start failed');
      }
      override async close() {
        closes++;
      }
    }
    const context = new Context(options, (options) => new API(options));
    await assert.rejects(context.getBrowser(), /start failed/);
    await assert.rejects(context.getBrowser(), /start failed/);
    await context.close();
    assert.equal(closes, 1);
  });
});
