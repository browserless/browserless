import { expect } from 'chai';
import type { Browser, Page } from 'puppeteer-core';
import Sinon from 'sinon';

import { FunctionRunner } from './client.js';

class TestFunctionRunner extends FunctionRunner {
  public setBrowser(browser: Browser): void {
    this.browser = browser;
  }

  public setPage(page: Page): void {
    this.page = page;
  }

  public execute(
    code: Parameters<FunctionRunner['start']>[0]['code'],
    context: unknown,
  ): Promise<unknown> {
    return this.runCode(code, context);
  }
}

describe('FunctionRunner', function () {
  afterEach(() => Sinon.restore());

  it('closes the page before disconnecting when user code rejects', async () => {
    const calls: string[] = [];
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
        calls.push('close');
        markCloseStarted();
        return close;
      }),
    } as unknown as Page;
    const browser = {
      disconnect: Sinon.stub().callsFake(() => calls.push('disconnect')),
    } as unknown as Browser;
    const runner = new TestFunctionRunner();
    const error = new Error('user code failed');
    runner.setPage(page);
    runner.setBrowser(browser);
    Sinon.stub(console, 'error');

    const execution = runner
      .execute(async () => {
        throw error;
      }, {})
      .catch((caught) => caught);
    await closeStarted;

    expect(calls).to.deep.equal(['close']);
    finishClose();

    expect(await execution).to.equal(error);
    expect(calls).to.deep.equal(['close', 'disconnect']);
  });

  it('cleans up when user code throws synchronously', async () => {
    const close = Sinon.stub().resolves();
    const disconnect = Sinon.stub();
    const page = { close } as unknown as Page;
    const browser = { disconnect } as unknown as Browser;
    const runner = new TestFunctionRunner();
    const error = new Error('synchronous user error');
    runner.setPage(page);
    runner.setBrowser(browser);
    Sinon.stub(console, 'error');

    const thrown = await runner
      .execute(() => {
        throw error;
      }, {})
      .catch((caught) => caught);

    expect(thrown).to.equal(error);
    expect(close.calledOnce).to.be.true;
    expect(disconnect.calledOnce).to.be.true;
  });

  it('preserves the user error when closing the page fails', async () => {
    const closeError = new Error('page close failed');
    const close = Sinon.stub().rejects(closeError);
    const disconnect = Sinon.stub();
    const page = { close } as unknown as Page;
    const browser = { disconnect } as unknown as Browser;
    const runner = new TestFunctionRunner();
    const userError = new Error('user code failed');
    const log = Sinon.stub(console, 'error');
    runner.setPage(page);
    runner.setBrowser(browser);

    const thrown = await runner
      .execute(async () => {
        throw userError;
      }, {})
      .catch((caught) => caught);

    expect(thrown).to.equal(userError);
    expect(close.calledOnce).to.be.true;
    expect(disconnect.calledOnce).to.be.true;
    expect(log.calledWith(`_browserless_function_client_: ${closeError}`)).to.be
      .true;
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
