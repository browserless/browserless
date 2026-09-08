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
import puppeteer from 'puppeteer-core';

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
  let proxy: Server | undefined;
  let port = 0;
  let proxyPort = 0;
  let proxyChallenges = 0;
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
    proxyChallenges = 0;
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      // A 401 endpoint for the page.authenticate() cases; everything else is
      // an image, which is the shape the blocked sub-resource cases use.
      if (req.url?.startsWith('/auth')) {
        if (!req.headers.authorization) {
          res.writeHead(401, {
            'content-type': 'text/html',
            'www-authenticate': 'Basic realm="probe"',
          });
          return res.end('<html><body>denied</body></html>');
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html><body>authed</body></html>');
      }
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    port = (server!.address() as AddressInfo).port;

    // A proxy that challenges once, so a 407 has to reach the client the same
    // way a 401 does. Chromium sends absolute-form requests to a proxy, so
    // nothing here has to resolve the name it is asked for.
    proxy = createServer((req, res) => {
      if (!req.headers['proxy-authorization']) {
        proxyChallenges++;
        res.writeHead(407, {
          'content-type': 'text/html',
          'proxy-authenticate': 'Basic realm="probe"',
        });
        return res.end('<html><body>proxy denied</body></html>');
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>authed</body></html>');
    });
    await new Promise<void>((resolve) =>
      proxy!.listen(0, '127.0.0.1', resolve),
    );
    proxyPort = (proxy!.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
    server?.close();
    server = undefined;
    proxy?.close();
    proxy = undefined;
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

  const launchGuarded = async (args: string[] = []) => {
    browser = new ChromiumCDP({
      blockAds: false,
      config: new GuardedConfig(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args }, stealth: false });
    return browser;
  };

  // Resolves every hostname to the probe server, so a case can use a name the
  // blocklist has an opinion about — or a lookalike it must not — and still be
  // served locally.
  const resolveEverythingLocally = () => [
    `--host-resolver-rules=MAP * 127.0.0.1:${port}`,
  ];

  const newGuardedPage = async (args: string[] = []) => {
    await launchGuarded(args);
    const page = await browser!.newPage();
    // 'targetcreated' fires the guard install asynchronously, so newPage() can
    // resolve before the blocklist is live.
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

  // `Network.setBlockedURLs` has no notion of an exemption, so the carve-out
  // has to be baked into the patterns (toBlockedUrlPatterns). Without it the
  // pages browserless serves itself — the /function runtime and its code —
  // stop loading, and blocking beats interception to the request, so the
  // handler that serves them never gets the chance.
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

  // Navigations are the one thing `Network.setBlockedURLs` does not apply to
  // (measured — sub-resources and renderer fetches are blocked, navigations
  // are not), so this is the observational teardown doing its job, not the
  // blocklist. The request does leave the browser; the route-level 403 and the
  // wire-protocol check are what stop the ones they can see, and a teardown
  // could never have unsent it anyway.
  it('still terminates a navigation that hides the host behind userinfo', async () => {
    const page = await newGuardedPage();

    await page
      .goto(`http://user:pass@127.0.0.1:${port}/nav`, { timeout: 10_000 })
      .catch(() => {});
    await waitFor(() => !browser!.isRunning());

    expect(browser!.isRunning(), 'blocked navigation must end the session').to
      .be.false;
  });

  // PLT-1596. The guard this replaced enabled `Fetch` on a second CDP session,
  // which swallowed the auth challenge for every request on the target: the
  // client was never asked for credentials and Chromium failed the navigation
  // with ERR_INVALID_AUTH_CREDENTIALS. It broke whether or not anything
  // matched the blocklist, and it took out ~5% of one customer's sessions.
  //
  // The client is a second puppeteer connection, as in production: the server
  // installs the guard on `targetcreated`, the customer drives a page over
  // their own connection.
  describe('with a client calling page.authenticate()', () => {
    const connectClient = async () => {
      const browserWSEndpoint = browser!.wsEndpoint();
      expect(browserWSEndpoint, 'browser should expose an endpoint').to.be.a(
        'string',
      );
      return puppeteer.connect({ browserWSEndpoint: browserWSEndpoint! });
    };

    // Three sequential pages: the original failure was a race between the
    // guard landing on the target and authenticate() arming, so one pass
    // proves less than a handful do.
    it('answers a site (401) challenge', async () => {
      // `auth.test` is deliberately not a name the blocklist covers: the
      // pre-fix guard broke auth even when nothing matched its patterns, and a
      // blocked host would confuse that with the navigation teardown.
      await launchGuarded(resolveEverythingLocally());
      const client = await connectClient();

      for (let attempt = 0; attempt < 3; attempt++) {
        const page = await client.newPage();
        // 'targetcreated' installs the guard asynchronously; give it the same
        // head start the pre-fix guard needed to lose this race.
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.authenticate({ password: 'pass', username: 'user' });

        const response = await page.goto('http://auth.test/auth', {
          timeout: 10_000,
        });

        expect(response?.status(), `attempt ${attempt}`).to.equal(200);
        expect(await page.evaluate(() => document.body.textContent)).to.equal(
          'authed',
        );
        await page.close();
      }

      await client.disconnect();
    });

    // The reported case: `/chrome?--proxy-server=…` with no credentials in the
    // flag, so the 407 has to reach the client's authenticate() too.
    it('answers a proxy (407) challenge', async () => {
      await launchGuarded([
        `--proxy-server=127.0.0.1:${proxyPort}`,
        // Chromium exempts loopback from proxying unless told otherwise.
        '--proxy-bypass-list=<-loopback>',
      ]);
      const client = await connectClient();
      const page = await client.newPage();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await page.authenticate({ password: 'pass', username: 'user' });

      const response = await page.goto('http://proxied.test/auth', {
        timeout: 10_000,
      });

      expect(response?.status()).to.equal(200);
      expect(
        proxyChallenges,
        'the proxy must have issued a challenge',
      ).to.be.greaterThan(0);
      await client.disconnect();
    });
  });

  // The patterns are the verdict now — nothing pauses to ask the matcher
  // afterwards — so a pattern that over-matches is a customer's sub-resource
  // that silently fails. This is the browser end of the anchoring asserted in
  // network-security.spec.ts: it also pins the assumption that Chromium
  // matches a pattern as an unanchored substring, which is what
  // matchesBlockedUrlPattern mirrors.
  it('leaves lookalike hosts alone', async () => {
    // Requested for real, rather than asserted against a re-implementation of
    // Chromium's matcher.
    const page = await newGuardedPage(resolveEverythingLocally());

    // 0.gravatar.com is the one that matters: an unanchored `0.` pattern
    // blocks it, and it sits on a great many WordPress sites.
    await page.setContent(
      '<img src="http://0.gravatar.test/avatar.svg">' +
        '<img src="http://localhostings.test/logo.svg">' +
        '<img src="http://127.example.test/logo.svg">',
    );
    const loaded = () => hits.filter((hit) => hit.endsWith('.svg')).length;
    await waitFor(() => loaded() >= 3);

    expect(loaded(), 'lookalike hosts must load').to.equal(3);
    expect(browser!.isRunning()).to.be.true;
  });
});
