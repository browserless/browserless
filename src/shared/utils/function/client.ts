import { Browser, Page } from 'puppeteer-core';
import { BrowserWebSocketTransport } from 'puppeteer-core/internal/common/BrowserWebSocketTransport.js';
import { _connectToCdpBrowser as connect } from 'puppeteer-core/internal/cdp/BrowserConnector.js';

type codeHandler = (params: {
  context: unknown;
  page: Page;
}) => Promise<unknown>;

// puppeteer-core >= 25.6 requires an explicit Logger on these internals.
const logger = () => undefined;

export class FunctionRunner {
  protected browser?: Browser;
  protected page?: Page;

  public log = (err: unknown) =>
    console.error(`_browserless_function_client_: ${err}`);

  protected async runCode(
    code: codeHandler,
    context: unknown,
  ): Promise<unknown> {
    return code({ context, page: this.page as Page }).catch(async (error) => {
      console.error(`Error running code: ${error}`);
      await this.page?.close().catch(this.log);
      this.browser?.disconnect();
      throw error;
    });
  }

  public async start(data: {
    browserWSEndpoint: string;
    code: codeHandler;
    context: unknown;
    options: {
      downloadPath?: string;
      protocolTimeout?: number;
    };
  }) {
    console.log(`/function.js: Got endpoint: "${data.browserWSEndpoint}"`);
    const { browserWSEndpoint, code, context, options } = data;
    const connectionTransport = await BrowserWebSocketTransport.create(
      browserWSEndpoint,
      undefined,
      logger,
    );
    const cdpOptions = {
      headers: {
        Host: '127.0.0.1',
      },
      protocolTimeout: options.protocolTimeout,
    };

    this.browser = (await connect(
      connectionTransport,
      browserWSEndpoint,
      cdpOptions,
      logger,
    )) as unknown as Browser;
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

    const response = await this.runCode(code, context);
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
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'BrowserlessFunctionRunner', {
    configurable: false,
    enumerable: false,
    value: FunctionRunner,
    writable: false,
  });
}
