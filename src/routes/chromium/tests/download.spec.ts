import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/download API', function () {
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

    await fetch('http://localhost:3000/download?token=browserless', {
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

    await fetch('http://localhost:3000/download', {
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
});
