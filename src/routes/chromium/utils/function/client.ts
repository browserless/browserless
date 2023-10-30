import { Page, Browser } from 'puppeteer-core';
import { _connectToCdpBrowser as connect } from 'puppeteer-core/lib/esm/puppeteer/cdp/BrowserConnector.js';

type codeHandler = (params: {
  context: unknown;
  page: Page;
}) => Promise<unknown>;

export class FunctionRunner {
  private browser?: Browser;
  private page?: Page;

  public log = () => console.log.bind(console);

  public async start(data: {
    browserWSEndpoint: string;
    code: codeHandler;
    context: unknown;
    options: {
      downloadPath?: string;
    };
  }) {
    console.log(`/function.js: Got endpoint: "${data.browserWSEndpoint}"`);
    const { browserWSEndpoint, code, context, options } = data;
    this.browser = (await connect({
      browserWSEndpoint,
      headers: {
        Host: '127.0.0.1',
      },
    })) as unknown as Browser;
    this.browser.once('disconnected', () => this.stop());
    this.page = await this.browser.newPage();

    if (options.downloadPath) {
      console.debug(
        `_browserless_function_client_: Setting downloads for page to "${options.downloadPath}"`,
      );
      // @ts-ignore
      const client = this.page._client.call(this.page);
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: options.downloadPath,
      });
    }

    const response = await code({ context, page: this.page });
    console.debug(
      `_browserless_function_client_: Code is finished executing, closing page.`,
    );
    this.page.close().catch(this.log);

    if (response instanceof Uint8Array) {
      return {
        contentType: 'uint8array',
        payload: Array.from(response),
      };
    }

    if (typeof response === 'string') {
      return {
        contentType: response.startsWith('<') ? 'text/html' : 'text/plain',
        payload: response,
      };
    }

    if (typeof response === 'object') {
      return {
        contentType: 'application/json',
        payload: JSON.stringify(response, null, '  '),
      };
    }

    return {
      contentType: 'text/plain',
      payload: response,
    };
  }

  public stop() {
    if (this.browser) this.browser.disconnect();
  }
}

// Set this as an immutable property on window so our handler's
// can call it downstream
Object.defineProperty(window, 'BrowserlessFunctionRunner', {
  configurable: false,
  enumerable: false,
  value: FunctionRunner,
  writable: false,
});
