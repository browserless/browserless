import puppeteer, { Browser } from 'puppeteer-core';

interface DownloadMessage {
  type: 'download';
  url: string;
  executablePath: string;
  options: {
    waitForSelector?: {
      selector: string;
      timeout?: number;
      visible?: boolean;
      hidden?: boolean;
    };
    cookies?: Array<{
      name: string;
      value: string;
      domain: string;
      path?: string;
    }>;
    headers?: Record<string, string>;
    gotoOptions?: {
      timeout?: number;
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    };
    userAgent?: string;
    viewport?: {
      width: number;
      height: number;
      deviceScaleFactor?: number;
    };
  };
}

let browser: Browser | null = null;

// Handle cleanup on exit
async function cleanup() {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      console.error('Error closing browser:', error);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  process.send?.({ type: 'error', error: error.message });
  await cleanup();
  process.exit(1);
});

// Handle messages from parent process
process.on('message', async (message: DownloadMessage) => {
  if (!message || message.type !== 'download' || !message.url || !message.executablePath) {
    process.send?.({ type: 'error', error: 'Invalid request - missing url or executablePath' });
    return;
  }

  try {
    // Launch browser if not already launched
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: message.executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
        ],
      });
    }

    const page = await browser.newPage();

    try {
      const {
        waitForSelector,
        cookies,
        headers,
        gotoOptions,
        userAgent,
        viewport,
      } = message.options;

      if (cookies?.length) {
        await page.setCookie(...cookies);
      }

      if (headers && Object.keys(headers).length) {
        await page.setExtraHTTPHeaders(headers);
      }

      if (userAgent) {
        await page.setUserAgent(userAgent);
      }

      if (viewport) {
        await page.setViewport(viewport);
      }

      const response = await page.goto(message.url, {
        waitUntil: gotoOptions?.waitUntil || 'networkidle0',
        ...gotoOptions,
      });

      if (!response) {
        throw new Error(`Failed to get response from ${message.url}`);
      }

      if (waitForSelector) {
        await page.waitForSelector(waitForSelector.selector, {
          hidden: waitForSelector.hidden,
          timeout: waitForSelector.timeout,
          visible: waitForSelector.visible,
        });
      }

      const contentType = response.headers()['content-type'];
      
      // Get the raw response data
      const rawResponse = await page.evaluate(async () => {
        const response = await fetch(window.location.href);
        const arrayBuffer = await response.arrayBuffer();
        return Array.from(new Uint8Array(arrayBuffer));
      });

      const buffer = Buffer.from(rawResponse);
      const contentLength = buffer.length;

      // Send metadata first
      process.send?.({
        type: 'metadata',
        contentType,
        contentLength,
        status: response.status(),
      });

      // Send the buffer in chunks to avoid memory issues
      const chunkSize = 1024 * 1024; // 1MB chunks
      for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        process.send?.({
          type: 'data',
          data: chunk.toString('base64'),
          bytesReceived: i + chunk.length,
          contentLength: buffer.length,
        });
      }

      process.send?.({ type: 'end' });
    } finally {
      await page.close();
    }
  } catch (error) {
    process.send?.({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}); 