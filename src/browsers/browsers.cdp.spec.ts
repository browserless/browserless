import {
  BrowserLauncherOptions,
  Config,
  Logger,
  availableBrowsers,
} from '@browserless.io/browserless';
import { expect } from 'chai';

import { ChromiumCDP } from './browsers.cdp.js';

describe('ChromiumCDP launch args', function () {
  let browser: ChromiumCDP | undefined;

  // Single-browser images (chrome, edge, firefox, webkit) ship no chromium
  // binary, so this suite has nothing to launch there.
  before(async function () {
    const installed = await availableBrowsers;
    if (!installed.includes(ChromiumCDP)) {
      this.skip();
    }
  });

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
  });

  const launch = async ({
    args = [],
    stealth = false,
  }: { args?: string[]; stealth?: boolean } = {}) => {
    browser = new ChromiumCDP({
      blockAds: false,
      config: new Config(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    const launchOptions: BrowserLauncherOptions = {
      options: { args },
      stealth,
    };
    await browser.launch(launchOptions);
    return browser.process()?.spawnargs ?? [];
  };

  it('disables the component updater', async function () {
    const spawnargs = await launch();

    expect(spawnargs).to.include('--disable-component-update');
  });

  it('keeps disabling it when the caller supplies its own args', async function () {
    const spawnargs = await launch({ args: ['--window-size=800,600'] });

    expect(spawnargs).to.include('--disable-component-update');
    expect(spawnargs).to.include('--window-size=800,600');
  });

  // puppeteer-extra's stealth launcher is a separate code path that rebuilds the
  // argv, so the switch has to be asserted through it too.
  it('disables the component updater on the stealth launcher', async function () {
    const spawnargs = await launch({ stealth: true });

    expect(spawnargs).to.include('--disable-component-update');
  });
});
