import {
  APITags,
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
  Logger,
  Methods,
  Request,
  contentTypes,
  dedent,
  SystemQueryParameters,
  chromeExecutablePath,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';
import { Readable } from 'stream';
import { fork } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Page as PuppeteerPage, HTTPResponse } from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Page = PuppeteerPage & {
  authenticate(credentials: { username: string; password: string }): Promise<void>;
  setCookie(...cookies: Array<{ name: string; value: string; domain: string; path?: string }>): Promise<void>;
  setUserAgent(userAgent: string): Promise<void>;
  setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
};

// Type definitions
export type BodySchema = {
  url: string;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
  headers?: Record<string, string>;
  gotoOptions?: {
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  };
  waitForSelector?: {
    selector: string;
    timeout?: number;
    visible?: boolean;
    hidden?: boolean;
  };
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  useExistingSession?: boolean;
  sessionId?: string;
};

export type QuerySchema = SystemQueryParameters & {
  token: string;
};

export type ResponseSchema = {
  success: boolean;
  error?: string;
};

// Schema validation objects
export const BodySchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'URL of the document to download',
    },
    cookies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          domain: { type: 'string' },
          path: { type: 'string' },
          expires: { type: 'number' },
          httpOnly: { type: 'boolean' },
          secure: { type: 'boolean' },
          sameSite: { 
            type: 'string',
            enum: ['Strict', 'Lax', 'None']
          },
        },
        required: ['name', 'value'],
      },
    },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    gotoOptions: {
      type: 'object',
      properties: {
        timeout: { type: 'number' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2']
        }
      }
    },
    waitForSelector: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        timeout: { type: 'number' },
        visible: { type: 'boolean' },
        hidden: { type: 'boolean' }
      },
      required: ['selector']
    },
    userAgent: { type: 'string' },
    viewport: {
      type: 'object',
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
        deviceScaleFactor: { type: 'number' }
      },
      required: ['width', 'height']
    },
    useExistingSession: { type: 'boolean' },
    sessionId: { type: 'string' }
  },
  required: ['url']
} as const;

export const QuerySchema = {
  type: 'object',
  properties: {
    token: { type: 'string' }
  },
  required: ['token']
} as const;

export const ResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' }
  },
  required: ['success']
} as const;

export default class ChromiumSiteDownloadPostRoute extends BrowserHTTPRoute {
  name = BrowserlessRoutes.ChromiumSiteDownloadPostRoute;
  accepts = [contentTypes.json];
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  contentTypes = [contentTypes.any];
  description = dedent(`
    A JSON-based API for downloading content from websites while maintaining security and privacy.
    Content is streamed through memory without being stored on disk, ensuring no sensitive data
    is retained. Supports custom headers, cookies, and wait conditions.
    Downloads are processed in an isolated sandbox process for enhanced security.
    Note: Authentication is not supported for security reasons - use cookies or headers instead.
    
    For existing browser sessions:
    - Set useExistingSession: true to use the current browser session
    - Optionally provide sessionId to use a specific session
  `);
  method = Methods.post;
  path = [HTTPRoutes.siteDownload, HTTPRoutes.chromiumSiteDownload];
  tags = [APITags.browserAPI];

  private async handleExistingSession(
    url: string,
    options: Omit<BodySchema, 'url' | 'useExistingSession' | 'sessionId'>,
    browser: BrowserInstance,
    logger: Logger
  ): Promise<{ stream: Readable; cleanup: () => Promise<void> }> {
    // The browser instance is already the active session, so we can create a new page directly
    const page = await browser.newPage() as unknown as Page;
    
    const outputStream = new Readable({
      read() {} // We'll push data manually
    });

    try {
      if (options.cookies?.length) {
        await page.setCookie(...options.cookies);
      }

      if (options.headers && Object.keys(options.headers).length) {
        await page.setExtraHTTPHeaders(options.headers);
      }

      if (options.userAgent) {
        await page.setUserAgent(options.userAgent);
      }

      if (options.viewport) {
        await page.setViewport(options.viewport);
      }

      const response = await page.goto(url, {
        waitUntil: options.gotoOptions?.waitUntil || 'networkidle0',
        ...options.gotoOptions,
      }) as HTTPResponse;

      if (!response) {
        throw new Error(`Failed to get response from ${url}`);
      }

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector.selector, {
          hidden: options.waitForSelector.hidden,
          timeout: options.waitForSelector.timeout,
          visible: options.waitForSelector.visible,
        });
      }

      const contentType = response.headers()['content-type'];
      const buffer = await response.buffer();

      // Emit metadata
      outputStream.emit('metadata', {
        contentType,
        contentLength: buffer.length,
        status: response.status(),
      });

      // Stream the buffer in chunks
      const chunkSize = 1024 * 1024; // 1MB chunks
      for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        outputStream.push(chunk);
      }

      outputStream.push(null); // End the stream

      return {
        stream: outputStream,
        cleanup: async () => {
          try {
            await page.close();
          } catch (err) {
            logger.error(`Error closing page: ${err}`);
          }
        }
      };
    } catch (error) {
      await page.close().catch(err => logger.error(`Error closing page: ${err}`));
      throw error;
    }
  }

  private createSandboxedDownload(
    url: string,
    options: Omit<BodySchema, 'url' | 'useExistingSession' | 'sessionId'>,
    logger: Logger
  ): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const outputStream = new Readable({
        read() {} // We'll push data manually from the messages
      });

      // Create isolated process with memory limits
      const sandboxProcess = fork(path.join(__dirname, '../workers/site-download.worker.js'), [], {
        execArgv: ['--max-old-space-size=512'], // 512MB RAM limit
      });

      // Set up timeout handling
      let timeoutId: NodeJS.Timeout;
      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          outputStream.destroy(new Error('Download timeout'));
          sandboxProcess.kill();
        }, 30000); // 30 second timeout
      };

      resetTimeout();

      // Get Chrome executable path
      const executablePath = chromeExecutablePath();

      // Send download request to child process
      sandboxProcess.send({
        type: 'download',
        url,
        executablePath,
        options
      });

      // Handle messages from the child process
      sandboxProcess.on('message', (message: any) => {
        resetTimeout();

        switch(message.type) {
          case 'metadata':
            outputStream.emit('metadata', {
              contentType: message.contentType,
              contentLength: message.contentLength,
              status: message.status
            });
            break;

          case 'data':
            // Convert base64 back to Buffer and push to our stream
            const chunk = Buffer.from(message.data, 'base64');
            outputStream.push(chunk);
            break;

          case 'end':
            // End of file has been reached
            outputStream.push(null);
            clearTimeout(timeoutId);
            sandboxProcess.kill();
            break;

          case 'error':
            // Error occurred in child process
            const error = new Error(message.error);
            outputStream.destroy(error);
            sandboxProcess.kill();
            break;
        }
      });

      // Handle process errors
      sandboxProcess.on('error', (error) => {
        logger.error(`Sandbox process error: ${error}`);
        outputStream.destroy(error);
        clearTimeout(timeoutId);
        reject(error);
      });

      // Handle process exit
      sandboxProcess.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (code !== 0 && !outputStream.destroyed) {
          const error = new Error(`Download process exited with code ${code}`);
          outputStream.destroy(error);
          reject(error);
        }
      });

      // Return the readable stream immediately
      resolve(outputStream);
    });
  }

  async handler(
    req: Request,
    res: ServerResponse,
    logger: Logger,
    browser: BrowserInstance,
  ): Promise<void> {
    logger.info(`Site download request received`, { url: (req.body as BodySchema)?.url });

    if (!req.body || !(req.body as BodySchema).url) {
      throw new BadRequest(`Missing "url" property in request body`);
    }

    const { url, useExistingSession, sessionId, ...options } = req.body as BodySchema;

    try {
      let downloadStream: Readable;
      let cleanup: (() => Promise<void>) | undefined;

      if (useExistingSession) {
        const result = await this.handleExistingSession(url, options, browser, logger);
        downloadStream = result.stream;
        cleanup = result.cleanup;
      } else {
        downloadStream = await this.createSandboxedDownload(url, options, logger);
      }

      // Set up metadata handling
      downloadStream.once('metadata', (metadata: { contentType: string; contentLength: number; status: number }) => {
        res.setHeader('Content-Type', metadata.contentType);
        res.setHeader('Content-Length', metadata.contentLength);
        res.setHeader('X-Original-URL', url);
        res.setHeader('X-Response-Code', metadata.status);
        res.setHeader('X-Content-Type', metadata.contentType);
        // Add additional headers for PDF handling
        res.setHeader('Content-Disposition', 'attachment; filename="downloaded.pdf"');
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('Accept-Ranges', 'bytes');
        if (sessionId) {
          res.setHeader('X-Session-ID', sessionId);
        }
      });

      // Pipe the download stream to the response
      downloadStream.pipe(res, { end: true });

      // Handle errors
      downloadStream.on('error', (error) => {
        logger.error(`Error during download: ${error}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end(`Download failed: ${error.message}`);
        }
      });

      // Clean up when done
      downloadStream.on('end', async () => {
        if (cleanup) {
          await cleanup();
        }
      });

    } catch (error) {
      logger.error(`Error initiating download: ${error}`);
      throw error;
    }
  }
} 