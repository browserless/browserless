import {
  Browserless,
  ChromiumCDP,
  Config,
  Metrics,
  availableBrowsers,
} from '@browserless.io/browserless';
import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import puppeteer from 'puppeteer-core';

/**
 * Scratch the Chromium family writes to the *shared* temp dir rather than to the
 * session's own directories. All of it is unlinked from a destructor that never
 * runs when the process exits on SIGKILL — which is how a browser ignoring
 * SIGTERM is ended — so each pattern here is a way for one session to
 * permanently cost the host disk.
 *
 * Matched by prefix, never by the random suffix, so a rename of the suffix
 * scheme in a browser bump still trips this.
 */
const SCRATCH_PATTERNS = [
  /^\.?(org\.chromium\.Chromium|com\.google\.Chrome|com\.microsoft\.Edge)\./,
  /^scoped_dir/,
  /^(chrome_crashpad|Crashpad)/,
  /^puppeteer_dev_chrome_profile-/,
];

const listTemp = async (dir: string) => fs.readdir(dir).catch(() => []);

const scratchIn = async (dir: string, before: Set<string>) =>
  (await listTemp(dir))
    .filter((entry) => !before.has(entry))
    .filter((entry) => SCRATCH_PATTERNS.some((p) => p.test(entry)))
    .sort();

describe('Browser scratch directories', function () {
  let browserless: Browserless;
  const config = new Config();

  before(async function () {
    const installed = await availableBrowsers;
    if (!installed.includes(ChromiumCDP)) {
      this.skip();
    }
  });

  beforeEach(() => {
    config.setToken('6R0W53R135510');
    browserless = new Browserless({ config, metrics: new Metrics() });
    return browserless.start();
  });

  afterEach(async () => {
    await browserless.stop();
  });

  const session = async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=6R0W53R135510`,
    });
    const page = await browser.newPage();
    await page.goto('about:blank');
    await browser.close();
  };

  it('leaves no browser scratch in the shared temp dir', async () => {
    const before = new Set(await listTemp(os.tmpdir()));

    await session();

    expect(await scratchIn(os.tmpdir(), before)).to.deep.equal([]);
  });

  it('removes the session scratch dir once the session ends', async () => {
    const scratchRoot = config.getScratchDir();
    const before = new Set(await listTemp(scratchRoot));

    await session();

    // The client's close() resolves when the socket does; the server-side
    // teardown that reclaims the dir runs after that, so poll rather than
    // asserting on the instant the connection drops.
    let left: string[] = [];
    const deadline = Date.now() + 10_000;
    do {
      left = (await listTemp(scratchRoot)).filter((e) => !before.has(e));
      if (!left.length) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);

    expect(left).to.deep.equal([]);
  });
});
