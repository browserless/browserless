import {
  Browserless,
  ChromiumCDP,
  Config,
  Hooks,
  Metrics,
} from '@browserless.io/browserless';
import { AddressInfo } from 'net';
import { createServer } from 'http';
import { expect } from 'chai';
import { readdir } from 'fs/promises';
import path from 'path';

describe('/chromium/download API', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('allows requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch('http://localhost:3000/chromium/download?token=browserless', {
      body: `export default async ({ page }) => {
        await page.evaluate(() => {
          const txtContent = "data:text/plain;charset=utf-8,Hello world!";
          const encodedUri = encodeURI(txtContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", "data.txt");
          document.body.appendChild(link);

          link.click();
        });
        await new Promise(r => setTimeout(r, 1000));
      }`,
      headers: {
        'content-type': 'application/javascript',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal('text/plain');
      expect(await res.text()).to.equal('Hello world!');
    });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();

    await fetch('http://localhost:3000/chromium/download', {
      body: `export default async ({ page }) => {
        await page.evaluate(() => {
          const txtContent = "data:text/plain;charset=utf-8,Hello world!";
          const encodedUri = encodeURI(txtContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", "data.txt");
          document.body.appendChild(link);

          link.click();
        });
        await new Promise(r => setTimeout(r, 1000));
      }`,
      headers: {
        'content-type': 'application/javascript',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal('text/plain');
      expect(await res.text()).to.equal('Hello world!');
    });
  });

  it('runs downloads when behind an unreachable external load-balancer URL', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setExternalAddress(
      'http://test-external.invalid:9999/e/abc123def456',
    );
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch('http://localhost:3000/chromium/download?token=browserless', {
      body: `export default async ({ page }) => {
        await page.evaluate(() => {
          const txtContent = "data:text/plain;charset=utf-8,Hello world!";
          const encodedUri = encodeURI(txtContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", "data.txt");
          document.body.appendChild(link);

          link.click();
        });
        await new Promise(r => setTimeout(r, 1000));
      }`,
      headers: {
        'content-type': 'application/javascript',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal('text/plain');
      expect(await res.text()).to.equal('Hello world!');
    });
  });

  it('runs downloads when behind an HTTPS external load-balancer URL', async () => {
    const config = new Config();
    config.setToken('browserless');
    // An HTTPS external address would make the in-page client a secure
    // context and forbid the ws://localhost:<port> WebSocket as mixed
    // content unless the page is navigated via the local server address.
    config.setExternalAddress(
      'https://test-external.invalid:9999/e/abc123def456',
    );
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch('http://localhost:3000/chromium/download?token=browserless', {
      body: `export default async ({ page }) => {
        await page.evaluate(() => {
          const txtContent = "data:text/plain;charset=utf-8,Hello world!";
          const encodedUri = encodeURI(txtContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", "data.txt");
          document.body.appendChild(link);

          link.click();
        });
        await new Promise(r => setTimeout(r, 1000));
      }`,
      headers: {
        'content-type': 'application/javascript',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal('text/plain');
      expect(await res.text()).to.equal('Hello world!');
    });
  });

  describe('when the triggered download fails', () => {
    let retries = 0;
    const fileServer = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>files</body></html>');
        return;
      }
      if (req.url === '/retry') {
        res.writeHead(++retries === 1 ? 403 : 200, {
          'content-type': 'text/html',
        });
        res.end('retry');
        return;
      }
      if (req.url === '/file') {
        res.writeHead(200, {
          'content-disposition': 'attachment; filename="file.bin"',
        });
        res.end(Buffer.from([0, 1, 254, 255]));
        return;
      }
      if (req.url === '/broken') {
        res.writeHead(200, {
          'content-disposition': 'attachment; filename="broken.bin"',
          'content-length': '100000',
        });
        res.write('partial');
        setTimeout(() => res.destroy(), 100);
        return;
      }
      if (req.url === '/slow') {
        res.writeHead(200, {
          'content-disposition': 'attachment; filename="slow.bin"',
          'content-type': 'application/octet-stream',
        });
        const drip = setInterval(() => res.write(Buffer.alloc(1024)), 100);
        res.on('close', () => {
          clearInterval(drip);
          onSlowClose?.();
        });
        return;
      }
      const status = Number(req.url?.split('/status/')[1]) || 404;
      res.writeHead(status, { 'content-type': 'text/html' });
      res.end(`<h1>${status}</h1>`);
    });
    let origin: string;
    let onSlowClose: (() => void) | undefined;

    before(async () => {
      await new Promise<void>((r) => fileServer.listen(0, '127.0.0.1', r));
      origin = `http://127.0.0.1:${(fileServer.address() as AddressInfo).port}`;
    });

    after(() => {
      fileServer.close();
    });

    it('preserves binary downloads, request interception and healthy keepalive', async () => {
      const hooks = new Hooks();
      const child: { process: ReturnType<ChromiumCDP['process']> } = {
        process: null,
      };
      hooks.browser = async ({ browser }) => {
        const cdp = browser as ChromiumCDP;
        cdp.setKeepUntil(Date.now() + 60_000);
        child.process = cdp.process();
      };
      browserless = new Browserless({ hooks });
      await browserless.start();
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: `export default async ({page, context}) => {
            await page.setRequestInterception(true);
            page.on('request', request => request.continue());
            await page.goto(context.origin);
            await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.download = ''; a.click(); }, context.url);
            await new Promise(r => setTimeout(r, 1000));
          }`,
          context: { origin, url: `${origin}/file` },
        }),
      });
      expect(res.status).to.equal(200);
      expect([...new Uint8Array(await res.arrayBuffer())]).to.deep.equal([
        0, 1, 254, 255,
      ]);
      expect(child.process).to.not.equal(null);
      expect(child.process?.exitCode).to.equal(null);
      expect(child.process?.signalCode).to.equal(null);
    });

    it('does not overwrite a failed download status with a later fetch to the same URL', async () => {
      await start();
      retries = 0;
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: `export default async ({page, context}) => {
            await page.goto(context.origin);
            await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.download = ''; a.click(); }, context.url);
            await new Promise(r => setTimeout(r, 1000));
            await page.evaluate(url => fetch(url).then(r => r.text()), context.url);
          }`,
          context: { origin, url: `${origin}/retry` },
        }),
      });
      expect(retries).to.equal(2);
      expect(res.status).to.equal(403);
      expect((await res.json()).error).to.contain('HTTP 403');
    });

    it('returns 502 for a canceled transfer without an HTTP error', async () => {
      await start();
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: `export default async ({page, context}) => {
            await page.goto(context.origin);
            await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.download = ''; a.click(); }, context.url);
            await new Promise(r => setTimeout(r, 1000));
          }`,
          context: { origin, url: `${origin}/broken` },
        }),
      });
      expect(res.status).to.equal(502);
      expect((await res.json()).error).to.contain(
        'without an HTTP error status',
      );
    });

    it('bounds the no-download wait even with TIMEOUT disabled', async () => {
      const config = new Config();
      config.setTimeout(0);
      await start({ config });
      const started = Date.now();
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'export default async () => {}' }),
      });
      expect(res.status).to.equal(404);
      expect((await res.json()).error).to.contain(
        'No download was started within 30s',
      );
      expect(Date.now() - started).to.be.within(30_000, 40_000);
    });

    it('removes the download directory when the function throws', async () => {
      const config = new Config();
      await start({ config });
      const downloadsDir = await config.getDownloadsDir();
      const listDownloadDirs = async () =>
        (await readdir(downloadsDir)).filter((name) =>
          name.startsWith('.browserless.download.'),
        );
      const dirsBefore = await listDownloadDirs();

      const res = await fetch('http://localhost:3000/chromium/download', {
        body: JSON.stringify({
          code: `export default async () => { throw new Error('boom'); }`,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      expect(res.status).to.not.equal(200);
      await new Promise((r) => setTimeout(r, 1000));
      const leftover = (await listDownloadDirs()).filter(
        (name) => !dirsBefore.includes(name),
      );
      expect(leftover).to.deep.equal([]);
    });

    for (const exit of ['client disconnect', 'request timeout'] as const) {
      it(`stops an active download and removes its directory on ${exit}`, async () => {
        const config = new Config();
        if (exit === 'request timeout') config.setTimeout(5000);
        await start({ config });
        const downloadsDir = await config.getDownloadsDir();
        const listDownloadDirs = async () =>
          (await readdir(downloadsDir)).filter((name) =>
            name.startsWith('.browserless.download.'),
          );
        const dirsBefore = await listDownloadDirs();
        const newDirs = async () =>
          (await listDownloadDirs()).filter(
            (name) => !dirsBefore.includes(name),
          );
        const transferStopped = new Promise<void>((r) => (onSlowClose = r));

        const controller = new AbortController();
        const req = fetch('http://localhost:3000/chromium/download', {
          body: JSON.stringify({
            code: `export default async ({ page, context }) => {
              await page.goto(context.origin);
              await page.evaluate((url) => {
                const link = document.createElement('a');
                link.href = url;
                link.download = '';
                document.body.appendChild(link);
                link.click();
              }, context.url);
              await new Promise((r) => setTimeout(r, 1000));
            }`,
            context: { origin, url: `${origin}/slow` },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        }).catch(() => null);

        let partial: string[] = [];
        for (let i = 0; i < 40 && !partial.length; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const [dir] = await newDirs();
          partial = dir
            ? (await readdir(path.join(downloadsDir, dir))).filter((f) =>
                f.endsWith('.crdownload'),
              )
            : [];
        }
        expect(partial, 'download should be in progress').to.have.length(1);

        if (exit === 'client disconnect') {
          controller.abort();
          await req;
        } else {
          expect((await req)?.status).to.equal(408);
        }

        await Promise.race([
          transferStopped,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('transfer kept running')), 5000),
          ),
        ]);
        await new Promise((r) => setTimeout(r, 2000));
        expect(await newDirs()).to.deep.equal([]);
      });
    }

    for (const delay of [1000, 20_000]) {
      it(`stops the browser after cleanup failures with keepalive and a ${delay}ms function`, async () => {
        const config = new Config();
        const hooks = new Hooks();
        const child: { process: ReturnType<ChromiumCDP['process']> } = {
          process: null,
        };
        hooks.browser = async ({ browser }) => {
          const cdp = browser as ChromiumCDP;
          child.process = cdp.process();
          cdp.setKeepUntil(Date.now() + 60_000);
          const newPage = cdp.newPage.bind(cdp);
          cdp.newPage = async () => {
            const page = await newPage();
            page.close = async () => {
              throw new Error('page close failed');
            };
            const target = page.browser().target();
            const createSession = target.createCDPSession.bind(target);
            target.createCDPSession = async () => {
              const session = await createSession();
              const send = session.send.bind(session);
              session.send = ((...args: Parameters<typeof send>) => {
                if (args[0] === 'Browser.cancelDownload')
                  return Promise.reject(new Error('cancel failed'));
                return send(...args);
              }) as typeof session.send;
              return session;
            };
            page.browser().target = () => target;
            return page;
          };
        };
        browserless = new Browserless({ config, hooks });
        await browserless.start();
        const downloadsDir = await config.getDownloadsDir();
        const before = await readdir(downloadsDir);
        const transferStopped = new Promise<void>(
          (resolve) => (onSlowClose = resolve),
        );
        const controller = new AbortController();
        const request = fetch('http://localhost:3000/chromium/download', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            code: `export default async ({page, context}) => {
            await page.goto(context.origin);
            await page.evaluate(url => {
              const a = document.createElement('a'); a.href = url; a.download = ''; a.click();
            }, context.url);
            await new Promise(r => setTimeout(r, context.delay));
          }`,
            context: { origin, url: `${origin}/slow`, delay },
          }),
        }).catch(() => null);
        let partial = false;
        for (let i = 0; i < 40 && !partial; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const dirs = (await readdir(downloadsDir)).filter(
            (name) =>
              !before.includes(name) &&
              name.startsWith('.browserless.download.'),
          );
          for (const dir of dirs) {
            partial ||= (await readdir(path.join(downloadsDir, dir))).some(
              (name) => name.endsWith('.crdownload'),
            );
          }
        }
        expect(partial, 'an active transfer is required').to.equal(true);
        if (delay === 1000) await new Promise((r) => setTimeout(r, 1500));
        controller.abort();
        await request;
        await Promise.race([
          transferStopped,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('transfer kept running')), 5000),
          ),
        ]);
        const process = child.process;
        expect(process).to.not.equal(null);
        for (
          let i = 0;
          i < 50 && process?.exitCode === null && process?.signalCode === null;
          i++
        )
          await new Promise((r) => setTimeout(r, 100));
        expect(
          process?.exitCode !== null || process?.signalCode !== null,
          'browser must exit despite keepalive',
        ).to.equal(true);
        let leftover: string[] = [];
        for (let i = 0; i < 50; i++) {
          leftover = (await readdir(downloadsDir)).filter(
            (name) =>
              !before.includes(name) &&
              name.startsWith('.browserless.download.'),
          );
          if (!leftover.length) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(leftover).to.deep.equal([]);
      });
    }

    for (const status of [403, 404, 429, 500]) {
      it(`preserves upstream status ${status} instead of hanging`, async () => {
        const config = new Config();
        await start({ config });
        const downloadsDir = await config.getDownloadsDir();
        const listDownloadDirs = async () =>
          (await readdir(downloadsDir)).filter((name) =>
            name.startsWith('.browserless.download.'),
          );
        const dirsBefore = await listDownloadDirs();
        const startedAt = Date.now();

        const res = await fetch('http://localhost:3000/chromium/download', {
          body: JSON.stringify({
            code: `export default async ({ page, context }) => {
              await page.goto(context.origin);
              await page.evaluate((url) => {
                const link = document.createElement('a');
                link.href = url;
                link.download = '';
                document.body.appendChild(link);
                link.click();
              }, context.url);
              await new Promise(r => setTimeout(r, 1000));
            }`,
            context: { origin, url: `${origin}/status/${status}` },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });

        expect(res.status).to.equal(status);
        const body = await res.json();
        expect(body.error).to.contain(`/status/${status}`);
        expect(body.error).to.contain(`HTTP ${status}`);
        expect(Date.now() - startedAt).to.be.below(15000);

        await new Promise((r) => setTimeout(r, 1000));
        const leftover = (await listDownloadDirs()).filter(
          (name) => !dirsBefore.includes(name),
        );
        expect(leftover).to.deep.equal([]);
      });
    }
  });
});
