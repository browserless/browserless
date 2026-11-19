import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { BrowserQL, BQLContextOptions } from '@browserless.io/browserless';

describe('nested browser mutation order', () => {
  it('finishes a nested click before a later sibling reads the changed page', async function () {
    if (!process.env.CHROME_PATH) this.skip();
    this.timeout(30_000);
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const service = new BrowserQL();
    const context = service.createContext({
      browser: { wsEndpoint: () => browser.wsEndpoint() },
      config: {},
      logger: { error() {} },
      req: {},
      blockConsentModals: false,
    } as BQLContextOptions);
    try {
      const result = await service.execute(
        {
          query: `mutation($html: String!) {
          content(html: $html) { time }
          outer: if(selector: "#enable") {
            a: evaluate(content: "(window.steps = ['a'], 'started')") { value }
            nested: ifnot(selector: "#absent") { click(selector: "#enable") { time } }
            d: evaluate(content: "(window.steps.push('d'), window.steps.join(','))") { value }
          }
        }`,
          variables: {
            html: '<!doctype html><button id="enable" onclick="window.steps.push(\'c\')">Enable</button>',
          },
        },
        context,
      );
      assert.equal(result.errors, undefined, JSON.stringify(result.errors));
      const data = JSON.parse(JSON.stringify(result.data));
      assert.equal(data.outer.d.value, 'a,c,d');
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
