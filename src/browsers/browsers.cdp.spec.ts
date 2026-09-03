import {
  BrowserLauncherOptions,
  Config,
  Logger,
  NetworkRangeSet,
  availableBrowsers,
} from '@browserless.io/browserless';
import { Server, createServer } from 'http';
import { AddressInfo } from 'net';
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

describe('ChromiumCDP blocked-URL guard', function () {
  let browser: ChromiumCDP | undefined;
  let server: Server | undefined;
  let port = 0;
  let hits: string[] = [];

  // A range set mirroring what a consumer opts into: loopback plus localhost.
  // The default OSS Config returns null (guard off), so the ranges have to come
  // from a subclass for these to exercise anything.
  class GuardedConfig extends Config {
    public getBlockedNetworkRanges(): NetworkRangeSet {
      return {
        hostnames: ['localhost'],
        ipv4Prefixes: ['127.', '169.254.'],
        ipv6Prefixes: ['::1'],
        protocols: [],
      };
    }
  }

  before(async function () {
    const installed = await availableBrowsers;
    if (!installed.includes(ChromiumCDP)) {
      this.skip();
    }
  });

  beforeEach(async () => {
    hits = [];
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    port = (server!.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
    server?.close();
    server = undefined;
  });

  // Positive assertions ("the request did happen", "the session did close")
  // race the browser: the fetch, the guard install and renderer scheduling all
  // have to land first, and a loaded CI box can take longer than any fixed
  // sleep. Negative assertions stay on a flat wait — there is nothing to poll
  // for when the expected outcome is that nothing happens.
  const waitFor = async (
    predicate: () => boolean,
    timeoutMS = 10_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMS;
    while (Date.now() < deadline && !predicate()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const newGuardedPage = async () => {
    browser = new ChromiumCDP({
      blockAds: false,
      config: new GuardedConfig(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args: [] }, stealth: false });
    const page = await browser.newPage();
    // 'targetcreated' fires the guard install asynchronously, so newPage() can
    // resolve before Fetch interception is live.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return page;
  };

  // https://careers.kinly.com/o/av-event-technician-38 — a job description
  // pasted out of Word, leaving the clipboard image behind. Chromium refuses
  // the scheme anyway; this used to cost the customer the whole session.
  it('survives a Word-pasted file:// image', async () => {
    const page = await newGuardedPage();

    await page.setContent(
      '<img src="file:///C:/Users/ANICHO~1/AppData/Local/Temp/msohtmlclip1/04/clip_image001.png">',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(browser!.isRunning()).to.be.true;
    expect(await page.evaluate(() => 1 + 1)).to.equal(2);
  });

  // https://fopconsultants.com/en/jobs/… — WordPress migrated off a local MAMP
  // install with the dev URL still in the content. Unlike file://, this request
  // does leave the browser, so the guard has to actually stop it.
  it('blocks a stale localhost image without ending the session', async () => {
    const page = await newGuardedPage();

    await page.setContent(
      `<img src="http://127.0.0.1:${port}/wordpress/wp-content/uploads/svg/world-map.svg">`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(hits, 'blocked request must not reach the destination').to.be.empty;
    expect(browser!.isRunning()).to.be.true;
    expect(await page.evaluate(() => 1 + 1)).to.equal(2);
  });

  // The reason this guard intercepts rather than using
  // Network.setBlockedURLs: glob blocking has no notion of an exemption, so
  // blocking loopback would also block the pages browserless serves itself
  // (e.g. the /function runtime).
  it("still allows the server's own origin through the same host", async () => {
    class SelfHostedConfig extends GuardedConfig {
      public getSelfNavigationHosts(): string[] {
        return [`127.0.0.1:${port}`];
      }
    }

    browser = new ChromiumCDP({
      blockAds: false,
      config: new SelfHostedConfig(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args: [] }, stealth: false });
    const page = await browser.newPage();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await page.setContent(`<img src="http://127.0.0.1:${port}/runtime.svg">`);
    await waitFor(() => hits.length > 0);

    expect(hits, 'self-origin request must not be blocked').to.not.be.empty;
    expect(browser.isRunning()).to.be.true;
  });

  // The other half of the split: sub-resources are tolerated, but a navigation
  // to a blocked destination still ends the session. Without this, narrowing
  // `isNavigation` further — or dropping the teardown entirely — would pass the
  // rest of this suite.
  for (const target of ['file:///etc/passwd', 'http://169.254.169.254/']) {
    it(`still terminates the session on a navigation to ${target}`, async () => {
      const page = await newGuardedPage();

      // The teardown races the navigation, so goto can reject with a detached
      // frame, resolve, or hang until the browser goes — none of which is the
      // assertion. `isRunning()` is.
      await page.goto(target, { timeout: 10_000 }).catch(() => {});
      await waitFor(() => !browser!.isRunning());

      expect(browser!.isRunning(), 'blocked navigation must end the session').to
        .be.false;
    });
  }

  // A credentialed navigation keeps its userinfo all the way to the pattern
  // matcher, so `*://127.*` alone would miss it and leave only the
  // observational path — which cannot stop a request that has already left.
  it('blocks a navigation that hides the host behind userinfo', async () => {
    const page = await newGuardedPage();

    await page
      .goto(`http://user:pass@127.0.0.1:${port}/nav`, { timeout: 10_000 })
      .catch(() => {});
    await waitFor(() => !browser!.isRunning());

    expect(hits, 'credentialed navigation must not reach the destination').to.be
      .empty;
  });
});
