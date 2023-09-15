import { expect } from 'chai';

import { Browserless } from '../../browserless.js';
import { Config } from '../../config.js';
import { Metrics } from '../../metrics.js';

describe('/download API', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    config.setToken('browserless');
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it.skip('allows requests', async () => {
    await start();

    await fetch('http://localhost:3000/download?token=browserless', {
      body: `export default async function ({ page }) {
        await page.evaluate(() => {
          const txtContent = "data:text/plain;charset=utf-8,Hello world!";
          const encodedUri = encodeURI(txtContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", "data.csv");
          document.body.appendChild(link);
      
          return link.click();
        });
      }`,
      headers: {
        'content-type': 'application/javascript',
      },
      method: 'POST',
    }).then(async (res) => {
      console.log(await res.text());
      expect;
      // const json = await res.json();

      // expect(json).to.have.property('data');
      // expect(json.data).to.equal('ok');
      // expect(res.status).to.equal(200);
    });
  });
  
});
