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
    const page = {
      close: Sinon.stub().callsFake(async () => {
        calls.push('close');
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

    let thrown: unknown;
    try {
      await runner.execute(async () => {
        throw error;
      }, {});
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).to.equal(error);
    expect(calls).to.deep.equal(['close', 'disconnect']);
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
