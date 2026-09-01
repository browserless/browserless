import { expect } from 'chai';
import type { Browser, Page } from 'puppeteer-core';
import Sinon from 'sinon';

import { FunctionRunner } from './client.js';

class TestFunctionRunner extends FunctionRunner {
  public async execute(
    browser: Browser,
    code: Parameters<FunctionRunner['start']>[0]['code'],
    context: unknown = {},
    options: Parameters<FunctionRunner['start']>[0]['options'] = {},
  ): Promise<unknown> {
    this.browser = browser;
    return this.runWithBrowser(code, context, options);
  }
}

describe('FunctionRunner', function () {
  beforeEach(() => Sinon.stub(console, 'debug'));
  afterEach(() => Sinon.restore());

  it('waits for the inner page to close before returning success', async () => {
    let finishClose = () => {};
    let markCloseStarted = () => {};
    const close = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve;
    });
    const page = {
      close: Sinon.stub().callsFake(() => {
        markCloseStarted();
        return close;
      }),
    } as unknown as Page;
    const browser = {
      disconnect: Sinon.stub(),
      newPage: Sinon.stub().resolves(page),
    } as unknown as Browser;
    const runner = new TestFunctionRunner();
    let settled = false;

    const execution = runner
      .execute(browser, async () => 'done')
      .then((result) => {
        settled = true;
        return result;
      });
    await closeStarted;

    expect(settled).to.be.false;
    finishClose();

    expect(await execution).to.deep.equal({
      contentType: 'text/plain',
      payload: 'done',
    });
    expect((browser.disconnect as Sinon.SinonStub).called).to.be.false;
  });

  it('cleans up when download setup fails after creating a page', async () => {
    const setupError = new Error('download setup failed');
    const close = Sinon.stub().resolves();
    const disconnect = Sinon.stub();
    const page = {
      _client: {
        call: () => ({ send: Sinon.stub().rejects(setupError) }),
      },
      close,
    } as unknown as Page;
    const browser = {
      disconnect,
      newPage: Sinon.stub().resolves(page),
    } as unknown as Browser;
    const runner = new TestFunctionRunner();

    const thrown = await runner
      .execute(browser, async () => undefined, {}, { downloadPath: '/tmp' })
      .catch((caught) => caught);

    expect(thrown).to.equal(setupError);
    expect(close.calledOnce).to.be.true;
    expect(disconnect.calledOnce).to.be.true;
  });

  it('bounds page cleanup and preserves the user error', async () => {
    const clock = Sinon.useFakeTimers();
    const close = Sinon.stub().returns(new Promise<void>(() => {}));
    const disconnect = Sinon.stub();
    const page = { close } as unknown as Page;
    const browser = {
      disconnect,
      newPage: Sinon.stub().resolves(page),
    } as unknown as Browser;
    const runner = new TestFunctionRunner();
    const userError = new Error('user code failed');
    Sinon.stub(console, 'error');

    const execution = runner
      .execute(browser, async () => {
        throw userError;
      })
      .catch((caught) => caught);
    await clock.tickAsync(2_000);

    expect(await execution).to.equal(userError);
    expect(close.calledOnce).to.be.true;
    expect(disconnect.calledOnce).to.be.true;
  });

  for (const asynchronous of [false, true]) {
    it(`preserves ${asynchronous ? 'asynchronous' : 'synchronous'} user errors when closing fails`, async () => {
      const closeError = new Error('page close failed');
      const close = Sinon.stub().rejects(closeError);
      const disconnect = Sinon.stub();
      const page = { close } as unknown as Page;
      const browser = {
        disconnect,
        newPage: Sinon.stub().resolves(page),
      } as unknown as Browser;
      const runner = new TestFunctionRunner();
      const userError = new Error('user code failed');
      const log = Sinon.stub(console, 'error');
      const code = asynchronous
        ? async () => {
            throw userError;
          }
        : () => {
            throw userError;
          };

      const thrown = await runner
        .execute(browser, code)
        .catch((caught) => caught);

      expect(thrown).to.equal(userError);
      expect(close.calledOnce).to.be.true;
      expect(disconnect.calledOnce).to.be.true;
      expect(log.calledWith(`_browserless_function_client_: ${closeError}`)).to
        .be.true;
    });
  }

  it('preserves the user error when disconnecting fails', async () => {
    const disconnectError = new Error('disconnect failed');
    const page = { close: Sinon.stub().resolves() } as unknown as Page;
    const browser = {
      disconnect: Sinon.stub().throws(disconnectError),
      newPage: Sinon.stub().resolves(page),
    } as unknown as Browser;
    const runner = new TestFunctionRunner();
    const userError = new Error('user code failed');
    const log = Sinon.stub(console, 'error');

    const thrown = await runner
      .execute(browser, async () => {
        throw userError;
      })
      .catch((caught) => caught);

    expect(thrown).to.equal(userError);
    expect(log.calledWith(`_browserless_function_client_: ${disconnectError}`))
      .to.be.true;
  });

  it('logs errors when passed as an unbound rejection handler', async () => {
    const log = Sinon.stub(console, 'error');
    const runner = new TestFunctionRunner();
    const error = new Error('page close failed');

    await Promise.reject(error).catch(runner.log);

    expect(log.calledOnceWithExactly(`_browserless_function_client_: ${error}`))
      .to.be.true;
  });
});
