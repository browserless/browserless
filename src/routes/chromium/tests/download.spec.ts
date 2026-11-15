import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { AddressInfo } from 'net';
import { createServer } from 'http';
import { expect } from 'chai';

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
    const fileServer = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>files</body></html>');
        return;
      }
      const status = Number(req.url?.split('/status/')[1]) || 404;
      res.writeHead(status, { 'content-type': 'text/html' });
      res.end(`<h1>${status}</h1>`);
    });
    let origin: string;

    before(async () => {
      await new Promise<void>((r) => fileServer.listen(0, '127.0.0.1', r));
      origin = `http://127.0.0.1:${(fileServer.address() as AddressInfo).port}`;
    });

    after(() => {
      fileServer.close();
    });

    for (const status of [403, 404, 500]) {
      it(`responds with a 404 instead of hanging when the download gets a ${status}`, async () => {
        await start();
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

        expect(res.status).to.equal(404);
        expect(await res.text()).to.contain(`/status/${status}`);
        expect(Date.now() - startedAt).to.be.below(15000);
      });
    }
  });
});
