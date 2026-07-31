import { Config, Logger } from '@browserless.io/browserless';
import { expect } from 'chai';

import { ChromiumCDP, disableComponentUpdaterArg } from './browsers.cdp.js';

describe('ChromiumCDP launch args', function () {
  let browser: ChromiumCDP | undefined;

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
  });

  const launch = async (args: string[] = []) => {
    browser = new ChromiumCDP({
      blockAds: false,
      config: new Config(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args } } as never);
    return browser.process()?.spawnargs ?? [];
  };

  it('disables the component updater', async function () {
    const spawnargs = await launch();

    expect(spawnargs).to.include(disableComponentUpdaterArg);
  });

  it('keeps disabling it when the caller supplies its own args', async function () {
    const spawnargs = await launch(['--window-size=800,600']);

    expect(spawnargs).to.include(disableComponentUpdaterArg);
    expect(spawnargs).to.include('--window-size=800,600');
  });
});
