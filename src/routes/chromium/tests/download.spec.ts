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
      if (req.url?.startsWith('/popup/')) {
        const [, , status, delay] = req.url.split('/');
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><body><script>
          setTimeout(() => {
            const link = document.createElement('a');
            link.href = '/status/${Number(status)}'; link.download = ''; link.click();
          }, ${Number(delay)});
        </script></body></html>`);
        return;
      }
      if (req.url === '/retry') {
        res.writeHead(++retries === 1 ? 403 : 200, {
          'content-type': 'text/html',
        });
        res.end('retry');
        return;
      }
      if (req.url === '/file' || req.url === '/delayed-file') {
        const send = () => {
          res.writeHead(200, {
            'content-disposition': 'attachment; filename="file.bin"',
          });
          res.end(Buffer.from([0, 1, 254, 255]));
        };
        if (req.url === '/delayed-file') setTimeout(send, 300);
        else send();
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
        onSlowStart?.();
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
    let onSlowStart: (() => void) | undefined;

    before(async () => {
      await new Promise<void>((r) => fileServer.listen(0, '127.0.0.1', r));
      origin = `http://127.0.0.1:${(fileServer.address() as AddressInfo).port}`;
    });

    after(() => {
      fileServer.close();
    });

    for (const file of ['/file', '/delayed-file']) {
      it(`returns an immediate-return download from ${file}`, async () => {
        const config = new Config();
        config.setTimeout(4000);
        await start({ config });
        const res = await fetch('http://localhost:3000/chromium/download', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: `export default async ({page, context}) => {
              await page.goto(context.origin);
              await page.evaluate(url => {
                const link = document.createElement('a');
                link.href = url; link.download = ''; link.click();
              }, context.url);
            }`,
            context: { origin, url: origin + file },
          }),
        });
        expect(res.status).to.equal(200);
        expect([...new Uint8Array(await res.arrayBuffer())]).to.deep.equal([
          0, 1, 254, 255,
        ]);
      });
    }

    it('fails before user code if the download directory cannot be configured', async () => {
      const hooks = new Hooks();
      hooks.browser = async ({ browser }) => {
        const cdp = browser as ChromiumCDP;
        const newPage = cdp.newPage.bind(cdp);
        cdp.newPage = async () => {
          const page = await newPage();
          const target = page.browser().target();
          const createSession = target.createCDPSession.bind(target);
          target.createCDPSession = async () => {
            const session = await createSession();
            const send = session.send.bind(session);
            session.send = ((...args: Parameters<typeof send>) =>
              args[0] === 'Browser.setDownloadBehavior'
                ? Promise.reject(new Error('download setup failed'))
                : send(...args)) as typeof session.send;
            return session;
          };
          page.browser().target = () => target;
          return page;
        };
      };
      browserless = new Browserless({ hooks });
      await browserless.start();
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'export default async () => { throw new Error("user code executed"); }',
        }),
      });
      expect(res.status).to.equal(500);
      expect(await res.text()).to.equal('Internal Server Error\n');
    });

    it('returns an error if the browser exits during a download with TIMEOUT disabled', async () => {
      const config = new Config();
      config.setTimeout(0);
      const hooks = new Hooks();
      let child: ReturnType<ChromiumCDP['process']> = null;
      hooks.browser = async ({ browser }) => {
        child = (browser as ChromiumCDP).process();
      };
      browserless = new Browserless({ config, hooks });
      await browserless.start();
      const started = new Promise<void>((resolve) => (onSlowStart = resolve));
      const response = fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: `export default async ({page, context}) => {
            const tab = await page.browser().newPage();
            await tab.goto(context.origin);
            await tab.evaluate(url => {
              const link = document.createElement('a');
              link.href = url; link.download = ''; link.click();
            }, context.url);
            await new Promise(r => setTimeout(r, 500));
          }`,
          context: { origin, url: origin + '/slow' },
        }),
      });
      await started;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(child).to.not.equal(null);
      (child as ReturnType<ChromiumCDP['process']>)?.kill('SIGKILL');
      const res = await response;
      expect(res.status).to.equal(502);
      expect((await res.json()).error).to.contain('browser disconnected');
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

    it('returns a completed download while another tab is still downloading', async () => {
      const config = new Config();
      config.setTimeout(5000);
      await start({ config });
      const stopped = new Promise<void>((resolve) => (onSlowClose = resolve));
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: `export default async ({page, context}) => {
            for (const url of [context.origin + '/slow', 'data:text/plain,complete']) {
              const tab = await page.browser().newPage();
              await tab.goto(context.origin);
              await tab.evaluate(url => {
                const link = document.createElement('a');
                link.href = url; link.download = 'z.txt'; link.click();
              }, url);
            }
            await new Promise(r => setTimeout(r, 1000));
          }`,
          context: { origin },
        }),
      });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('complete');
      await Promise.race([
        stopped,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('transfer kept running')), 5000),
        ),
      ]);
    });

    it('does not overwrite a paused download status with a concurrent fetch to the same URL', async () => {
      await start();
      retries = 0;
      const res = await fetch('http://localhost:3000/chromium/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: `export default async ({page, context}) => {
            const client = await page.createCDPSession();
            let resume;
            const paused = new Promise(resolve => {
              client.on('Fetch.requestPaused', event => {
                const proceed = () => client.send('Fetch.continueRequest', {requestId: event.requestId});
                if (event.request.url === context.url && event.responseStatusCode === 403) {
                  resume = proceed;
                  resolve();
                } else {
                  void proceed();
                }
              });
            });
            await client.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Response'}]});
            await page.goto(context.origin);
            await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.download = ''; a.click(); }, context.url);
            await paused;
            await page.evaluate(url => fetch(url).then(r => r.text()), context.url);
            await resume();
            await new Promise(r => setTimeout(r, 500));
          }`,
          context: { origin, url: `${origin}/retry` },
        }),
      });
      expect(retries).to.equal(2);
      expect(res.status).to.equal(403);
      expect((await res.json()).error).to.contain('HTTP 403');
    });

    for (const [status, delay] of [
      [403, 0],
      [429, 1500],
    ]) {
      it(`preserves popup status ${status} with a ${delay}ms delayed download`, async () => {
        await start();
        const res = await fetch('http://localhost:3000/chromium/download', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: `export default async ({page, context}) => {
              await page.goto(context.origin);
              await page.evaluate(url => window.open(url), context.url);
              await new Promise(r => setTimeout(r, 500));
            }`,
            context: { origin, url: `${origin}/popup/${status}/${delay}` },
          }),
        });
        expect(res.status).to.equal(status);
        expect((await res.json()).error).to.contain(`HTTP ${status}`);
      });
    }

    for (const target of ['fragment', 'tab', 'iframe']) {
      it(`preserves upstream status for a download from a ${target}`, async () => {
        await start();
        const res = await fetch('http://localhost:3000/chromium/download', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: `export default async ({page, context}) => {
              await page.goto(context.origin);
              let target = page;
              if (context.target === 'tab') {
                target = await page.browser().newPage();
                await target.goto(context.origin);
              } else if (context.target === 'iframe') {
                await page.evaluate(url => {
                  const frame = document.createElement('iframe'); frame.src = url;
                  document.body.appendChild(frame);
                }, context.frameOrigin);
                target = await page.waitForFrame(frame => frame.url() === context.frameOrigin + '/');
                await target.waitForSelector('body');
              }
              await target.evaluate(url => {
                const link = document.createElement('a'); link.href = url;
                link.download = ''; link.click();
              }, context.url);
              await new Promise(r => setTimeout(r, 500));
            }`,
            context: {
              origin,
              frameOrigin: origin.replace('127.0.0.1', 'localhost'),
              target,
              url: `${target === 'iframe' ? origin.replace('127.0.0.1', 'localhost') : origin}/status/403${target === 'fragment' ? '#file' : ''}`,
            },
          }),
        });
        expect(res.status).to.equal(403);
        expect((await res.json()).error).to.contain('HTTP 403');
      });
    }

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
        'without an observed HTTP error status',
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
