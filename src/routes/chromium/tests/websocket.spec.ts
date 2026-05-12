import {
  Browserless,
  BrowserlessSessionJSON,
  Config,
  Hooks,
  Metrics,
  exists,
  fetchJson,
  sleep,
} from '@browserless.io/browserless';
import { chromium } from 'playwright-core';
import { deleteAsync } from 'del';
import { expect } from 'chai';
import fs from 'fs/promises';
import puppeteer from 'puppeteer-core';

describe('Chromium WebSocket API', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    hooks,
    metrics = new Metrics(),
  }: { config?: Config; hooks?: Hooks; metrics?: Metrics } = {}) => {
    browserless = new Browserless({ config, hooks, metrics });
    return browserless.start();
  };

  // Bounded polling for cleanup assertions. Filesystem + process-exit
  // timing is non-deterministic, so a fixed sleep flakes on slower CI.
  // Throws on timeout so a failure is loud, not silent.
  const waitFor = async (
    predicate: () => Promise<boolean>,
    timeoutMs = 5000,
    intervalMs = 50,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await sleep(intervalMs);
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms`);
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('runs chromium websocket requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    await browser.close();
  });

  it('runs chromium Playwright-CDP requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await chromium.connectOverCDP(
      `ws://localhost:3000/chromium?token=browserless`,
    );
    const context = await browser.newContext();
    await context.newPage();

    await browser.close();
  });

  it('runs multiple websocket requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    await Promise.all([browser.disconnect(), browserTwo.disconnect()]);
  });

  it('does not close browsers when multiple clients are connected', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    // Single session
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });
    await sleep(100);
    const [session] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(session.numbConnected).to.equal(1);

    // Two sessions
    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/devtools/browser/${session.browserId}?token=browserless`,
    });
    await sleep(100);
    const [twoSessions] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(twoSessions.numbConnected).to.equal(2);

    // Back to a single session
    await browser.disconnect();
    await sleep(100);
    const [oneSession] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(oneSession.numbConnected).to.equal(1);

    // No sessions connected
    await browserTwo.disconnect();
    await sleep(100);
    const sessionsFinal = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(sessionsFinal).to.have.length(0);
  });

  it('disconnects all clients when the timeout is reached', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setTimeout(1000);
    config.setConcurrent(2);
    const metrics = new Metrics();
    await start({ config, metrics });
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });
    const [session] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/devtools/browser/${session.browserId}?token=browserless`,
    });
    await sleep(3000);
    expect(metrics.get().successful).to.equal(0);
    expect(metrics.get().timedout).to.equal(2);
    expect(browser.connected).to.be.false;
    expect(browserTwo.connected).to.be.false;
  });

  it('rejects websocket requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=bad`,
      })
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('rejects file protocol requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
      })
      .then(async (b) => {
        const page = await b.newPage();
        await page.goto('file:///etc/passwd');
        await page.content();
        await b.disconnect();
        return false;
      })
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('runs with ignored arguments', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const args = {
      ignoreDefaultArgs: true,
    };

    const success = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${JSON.stringify(
          args,
        )}`,
      })
      .then(async (b) => {
        const page = await b.newPage();
        await page.close();
        await b.disconnect();
        return true;
      })
      .catch(() => false);

    expect(success).to.be.true;
  });

  it('deletes user-data-dirs when not specified', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await waitFor(async () => !(await exists(userDataDir)));
  });

  it('deletes user-data-dirs when launch fails', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    const hooks = new Hooks();
    hooks.browser = async () => {
      throw new Error('simulated post-launch hook failure');
    };
    await start({ config, hooks, metrics });

    const baseDir = await config.getDataDir();
    const before = await fs.readdir(baseDir).catch((): string[] => []);

    const attempts = 3;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        puppeteer
          .connect({
            browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
          })
          .then(() => 'connected')
          .catch((err: Error) => err.message),
      ),
    );
    expect(results.every((r) => r !== 'connected')).to.be.true;
    // Distinguish from infrastructure failures (ECONNREFUSED, bad
    // token → 401, etc.) which would never have produced a data-dir
    // in the first place. The hook throwing produces a 500 from the
    // route handler.
    expect(results.every((r) => r.includes('500'))).to.be.true;

    await waitFor(async () => {
      const after = await fs.readdir(baseDir).catch((): string[] => []);
      return after.every((entry) => before.includes(entry));
    });

    const after = await fs.readdir(baseDir).catch(() => []);
    const leaked = after.filter((entry) => !before.includes(entry));
    expect(leaked).to.deep.equal([]);
  });

  it('deletes user-data-dirs when the server shuts down with active sessions', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const baseDir = await config.getDataDir();
    const before = await fs.readdir(baseDir).catch((): string[] => []);

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const sessionsRes = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    );
    expect(sessionsRes.status).to.equal(200);
    const [{ userDataDir }] = await sessionsRes.json();
    expect(await exists(userDataDir)).to.be.true;

    // Stop WITHOUT first disconnecting the client; mirrors the
    // SIGTERM-with-active-sessions case that was leaking.
    await browserless.stop();

    await waitFor(async () => !(await exists(userDataDir)));
    const after = await fs.readdir(baseDir).catch(() => []);
    expect(after.filter((e) => !before.includes(e))).to.deep.equal([]);

    await browser.disconnect().catch(() => undefined);

    // Replace the shared `browserless` with a stub so the global
    // `afterEach` does not call stop() a second time on an already
    // shut-down HTTP server.
    browserless = {
      stop: () => Promise.resolve([]),
    } as unknown as Browserless;
  });

  it('deletes user-data-dirs when the session is killed via /kill', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const preKillRes = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    );
    expect(preKillRes.status).to.equal(200);
    const [session] = await preKillRes.json();
    const userDataDir: string = session.userDataDir;
    const killURL: string = session.killURL;
    expect(await exists(userDataDir)).to.be.true;

    const killResponse = await fetch(`${killURL}?token=browserless`, {
      method: 'GET',
    });
    expect(killResponse.status).to.equal(204);

    // Synchronous-eviction contract: by the time /kill returns, the
    // session must no longer be visible to /sessions, even though
    // browser.close() may still be running.
    const postKillRes = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    );
    expect(postKillRes.status).to.equal(200);
    expect(await postKillRes.json()).to.deep.equal([]);

    await waitFor(async () => !(await exists(userDataDir)));
    await browser.disconnect().catch(() => undefined);
  });

  it('deletes user-data-dirs when the browser exits unexpectedly', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const client = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const sessionsRes = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    );
    expect(sessionsRes.status).to.equal(200);
    const [{ userDataDir }] = await sessionsRes.json();
    expect(await exists(userDataDir)).to.be.true;

    // Reach into the manager to grab the wrapper, then kill the
    // underlying chromium process directly. This simulates an OOM
    // kill from the kernel: no graceful shutdown, no WebSocket close
    // initiated by the peer.
    const browserManager = (
      browserless as unknown as { browserManager: { browsers: Map<unknown, unknown> } }
    ).browserManager;
    const [wrapper] = Array.from(browserManager.browsers.keys()) as Array<{
      process: () => { kill: (sig: string) => void } | null;
    }>;
    const chromiumProcess = wrapper.process();
    expect(chromiumProcess).to.not.be.null;
    chromiumProcess!.kill('SIGKILL');

    await waitFor(async () => !(await exists(userDataDir)), 10000);
    await client.disconnect().catch(() => undefined);
  });

  it('allows specified user-data-dirs', async () => {
    const dataDir = '/tmp/data-dir-1';
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const launch = JSON.stringify({
      args: [`--user-data-dir=${dataDir}`],
    });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());

    expect(await exists(userDataDir)).to.be.true;
    expect(userDataDir).to.equal(dataDir);

    await browser.disconnect();
    await sleep(1000);

    expect(await exists(userDataDir)).to.be.true;
  });

  it('creates user-data-dirs with userDataDir options', async () => {
    const dataDirLocation = '/tmp/browserless-test-dir';
    const launch = JSON.stringify({
      userDataDir: dataDirLocation,
    });
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());

    expect(userDataDir === dataDirLocation).to.be.true;
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(500);

    expect(await exists(userDataDir)).to.be.true;
    await deleteAsync(userDataDir, { force: true });
  });

  it('creates user-data-dirs with CLI flags', async () => {
    const dataDirLocation = '/tmp/browserless-test-dir';
    const launch = JSON.stringify({
      args: [`--user-data-dir=${dataDirLocation}`],
    });
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());

    expect(userDataDir === dataDirLocation).to.be.true;
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(500);

    expect(await exists(userDataDir)).to.be.true;
    await deleteAsync(userDataDir, { force: true });
  });

  it('runs with job-based timeouts', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setTimeout(-1); // No timeout
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?timeout=1000&token=browserless`,
    });
    expect(browser.connected).to.be.true;
    await sleep(1200);
    expect(metrics.get().timedout).to.equal(1);
    expect(metrics.get().successful).to.equal(0);
    expect(browser.connected).to.be.false;
  });

  it('allows the file-chooser', async () =>
    new Promise(async (done) => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
        });

        const page = await browser.newPage();

        await page.setContent(`<div class="output" style="height: 62%;"><label for="avatar">Choose a profile picture:</label>
      <input type="file" id="avatar" name="avatar" accept="image/png, image/jpeg">
    </div>`);

        if (page.waitForFileChooser) {
          const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.click('#avatar'),
          ]);
          expect(fileChooser).to.not.be.undefined;
          expect(fileChooser).to.not.be.null;
        }
        browser.disconnect();
        done();
      };

      job();
    }));

  it('queues requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setConcurrent(1);
    const metrics = new Metrics();
    await start({ config, metrics });

    const job = async () => {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
      });
      await sleep(100);

      return browser.disconnect();
    };

    await Promise.all([job(), job()]);

    await sleep(100);

    const results = metrics.get();
    expect(results.successful).to.equal(2);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(1);
  });

  it('fails requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setConcurrent(0);
    config.setQueued(0);
    const metrics = new Metrics();
    await start({ config, metrics });

    return puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
      })
      .catch((error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(1);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain.oneOf([`400`, `429`]);
      });
  });

  it('fails requests without tokens', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    return puppeteer
      .connect({ browserWSEndpoint: `ws://localhost:3000/chromium` })
      .catch((error: Error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(0);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain(`401`);
      });
  });

  it('runs playwright', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await chromium.connect(
      `ws://localhost:3000/chromium/playwright?token=browserless`,
    );

    await browser.close();
    await sleep(100);

    const results = metrics.get();
    expect(results.timedout).to.equal(0);
    expect(results.successful).to.equal(1);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(0);
  });

  it('runs playwright over CDP', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await chromium.connectOverCDP(
      `ws://localhost:3000/chromium?token=browserless`,
    );

    await browser.close();
    await sleep(100);

    const results = metrics.get();
    expect(results.timedout).to.equal(0);
    expect(results.successful).to.equal(1);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(0);
  });

  it('runs multiple versions of playwright', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const pwVersions = Object.keys(config.getPwVersions());

    for (const version of pwVersions) {
      const pw = await import(config.getPwVersions()[version]);
      const browser = await pw.chromium.connect(
        `ws://localhost:3000/playwright/chromium?token=browserless`,
      );

      await browser.close();
      await sleep(100);
    }

    const results = metrics.get();
    expect(results.timedout).to.equal(0);
    expect(results.successful).to.equal(pwVersions.length);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(0);
  });

  it('rejects playwright without tokens', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await chromium
      .connect(`ws://localhost:3000/chromium/playwright`)
      .catch((e) => {
        const results = metrics.get();
        expect(e.message).to.include('Bad or missing authentication');
        expect(results.timedout).to.equal(0);
        expect(results.successful).to.equal(0);
        expect(results.unauthorized).to.equal(1);
        expect(results.queued).to.equal(0);
      });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium`,
    });

    await browser.disconnect();
  });

  it('launches headless correctly', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const getVersion = () => {
      return document.querySelector('#command_line')?.textContent;
    };

    const runPuppeteer = async (launch: string) => {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
      });

      const page = await browser.newPage();
      await page.goto('chrome://version/');
      const command = await page.evaluate(getVersion);
      await browser.close();

      return command;
    };

    const runPlaywright = async (launch: string) => {
      const browser = await chromium.connect(
        `ws://localhost:3000/chromium/playwright?token=browserless&launch=${launch}`,
      );

      const page = await browser.newPage();
      await page.goto('chrome://version/');
      const command = await page.evaluate(getVersion);
      await browser.close();

      return command;
    };

    // Test headless=new
    let launch = JSON.stringify({
      args: ['--headless=new'],
    });

    let pptrCommand = await runPuppeteer(launch);
    let pwCommand = await runPlaywright(launch);

    expect(pptrCommand).to.include('--headless=new');
    expect(pwCommand).to.include('--headless=new');

    // Test headless false
    launch = JSON.stringify({
      headless: false,
    });

    pptrCommand = await runPuppeteer(launch);
    pwCommand = await runPlaywright(launch);

    expect(pptrCommand).not.to.include('--headless');
    expect(pwCommand).not.to.include('--headless');

    // Test headless true (should default to headless=new for puppeteer and headless for playwright)
    launch = JSON.stringify({
      headless: true,
    });

    pptrCommand = await runPuppeteer(launch);
    pwCommand = await runPlaywright(launch);

    expect(pptrCommand).to.include('--headless=new');
    expect(pwCommand).to.include('--headless');
  });

  it('Throws an error while creating a session with invalid trackingId', async () => {
    await start();

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?trackingId=all`,
      })
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('Throws an error while creating a session with duplicated trackingId', async () => {
    await start();

    await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?trackingId=duplicated`,
    });
    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?trackingId=duplicated`,
      })
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });
});
