import {
  Browserless,
  ChromiumCDP,
  Config,
  Metrics,
  availableBrowsers,
  generateScratchDir,
} from '@browserless.io/browserless';
import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
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

  const connect = () =>
    puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=6R0W53R135510`,
    });

  const session = async () => {
    const browser = await connect();
    try {
      const page = await browser.newPage();
      await page.goto('about:blank');
    } finally {
      await browser.close();
    }
  };

  it('leaves no browser scratch in the shared temp dir', async () => {
    const before = new Set(await listTemp(os.tmpdir()));

    await session();

    expect(await scratchIn(os.tmpdir(), before)).to.deep.equal([]);
  });

  it('removes the session scratch dir once the session ends', async () => {
    const scratchRoot = config.getScratchDir();
    const before = new Set(await listTemp(scratchRoot));
    const browser = await connect();
    let scratchDir: string;

    try {
      const page = await browser.newPage();
      await page.goto('about:blank');

      const created = (await fs.readdir(scratchRoot)).filter(
        (entry) => !before.has(entry),
      );
      expect(created).to.have.length(1);
      scratchDir = path.join(scratchRoot, created[0]);
      await fs.access(scratchDir);
    } finally {
      await browser.close();
    }

    // The client's close() resolves when the socket does; the server-side
    // teardown that reclaims the dir runs after that, so poll rather than
    // asserting on the instant the connection drops.
    let removed = false;
    const deadline = Date.now() + 10_000;
    do {
      try {
        await fs.access(scratchDir!);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        removed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);

    expect(removed).to.equal(true);
  });

  it('removes the generated data dir when scratch creation fails', async () => {
    const dataRoot = await config.getDataDir();
    const before = new Set(await fs.readdir(dataRoot));
    const originalScratchRoot = config.getScratchDir();
    const blockerRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'scratch-blocker-'),
    );
    const blocker = path.join(blockerRoot, 'file');
    let createdDataDirs: string[] = [];

    await fs.writeFile(blocker, '');
    (config as unknown as { scratchDir: string }).scratchDir = path.join(
      blocker,
      'nested',
    );

    try {
      let scratchError: Error | undefined;
      await generateScratchDir(undefined, config).catch((err) => {
        scratchError = err;
      });
      expect(scratchError).to.be.instanceOf(Error);
      expect(scratchError?.message).to.include(
        'Error creating scratch directory',
      );

      let connectionError: unknown;
      await connect().catch((err) => {
        connectionError = err;
      });
      createdDataDirs = (await fs.readdir(dataRoot)).filter(
        (entry) => !before.has(entry),
      );

      expect(connectionError).to.not.equal(undefined);
      expect(createdDataDirs).to.deep.equal([]);
    } finally {
      (config as unknown as { scratchDir: string }).scratchDir =
        originalScratchRoot;
      await Promise.all(
        createdDataDirs.map((entry) =>
          fs.rm(path.join(dataRoot, entry), { recursive: true, force: true }),
        ),
      );
      await fs.rm(blockerRoot, { recursive: true, force: true });
    }
  });

  /**
   * The TMPDIR override is merged over `process.env`, since both launchers
   * replace the child environment wholesale rather than merging. That merged
   * object must never reach the session record: /sessions serves
   * `launchOptions` verbatim, so storing it there would publish TOKEN and every
   * other host credential to anyone who can read the endpoint.
   */
  it('does not publish the browser environment through /sessions', async () => {
    const originalSecret = process.env.SCRATCH_SPEC_SECRET;
    let browser: Awaited<ReturnType<typeof connect>> | undefined;

    try {
      process.env.SCRATCH_SPEC_SECRET = 'must-not-be-served';
      browser = await connect();
      const res = await fetch(
        'http://localhost:3000/sessions?token=6R0W53R135510',
      );
      const body = await res.text();
      const sessions = JSON.parse(body) as Array<{
        launchOptions?: Record<string, unknown>;
      }>;

      expect(sessions).to.have.length.greaterThan(0);
      for (const s of sessions) {
        expect(s.launchOptions ?? {}).to.not.have.property('env');
      }
      expect(body).to.not.include('must-not-be-served');
    } finally {
      if (originalSecret === undefined) {
        delete process.env.SCRATCH_SPEC_SECRET;
      } else {
        process.env.SCRATCH_SPEC_SECRET = originalSecret;
      }
      await browser?.close();
    }
  });
});
