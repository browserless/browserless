/* eslint-disable no-unused-expressions */
import * as http from 'http';
import {
  BrowserInstance,
  Config,
  Logger,
  Request,
} from '@browserless.io/browserless';
import { expect } from 'chai';
import { Page } from 'puppeteer-core';
import ChromiumPDFPostRoute from '../pdf.http.js';

class TestPDFRoute extends ChromiumPDFPostRoute {
  constructor() {
    super(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  }
}

const makeRequest = (body: unknown): Request => {
  const req = new http.IncomingMessage(
    null as unknown as import('net').Socket,
  ) as Request;
  req.url = '/chromium/pdf';
  req.method = 'POST';
  req.body = body;
  return req;
};

const makeResponse = (onData: (chunk: Uint8Array) => void) => {
  const res = {
    headers: {} as Record<string, string>,
    writableEnded: false,
    setHeader: (name: string, value: string) => {
      res.headers[name] = value;
    },
    write: (chunk: Uint8Array) => {
      onData(chunk);
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
  };
  return res as unknown as http.ServerResponse;
};

const makePage = (hooks: {
  onClose?: () => Promise<void>;
}): Page & { closeCalled: boolean } => {
  let closeCalled = false;
  const page = {
    setContent: async () => undefined,
    createPDFStream: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('%PDF-1.4 fake'));
          controller.close();
        },
      }),
    removeAllListeners: () => undefined,
    close: async () => {
      closeCalled = true;
      await hooks.onClose?.();
    },
  } as unknown as Page & { closeCalled: boolean };
  Object.defineProperty(page, 'closeCalled', {
    get: () => closeCalled,
  });
  return page;
};

const settle = (ms = 50): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('ChromiumPDFPostRoute page cleanup', function () {
  it('streams the pdf bytes and closes the page', async function () {
    const route = new TestPDFRoute();
    const chunks: Buffer[] = [];
    const res = makeResponse((chunk) => chunks.push(Buffer.from(chunk)));
    const page = makePage({});
    const browser = {
      getConfig: () => new Config(),
      newPage: async () => page,
    } as unknown as BrowserInstance;

    await route.handler(
      makeRequest({ html: '<h1>Hello</h1>' }),
      res,
      new Logger('pdf-cleanup'),
      browser,
    );

    expect(Buffer.concat(chunks).toString()).to.equal('%PDF-1.4 fake');
    expect(res.writableEnded).to.be.true;
    expect(page.closeCalled).to.be.true;
  });

  it('waits for the page to close before the handler resolves', async function () {
    const route = new TestPDFRoute();
    const res = makeResponse(() => undefined);
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const page = makePage({ onClose: () => closeGate });
    const browser = {
      getConfig: () => new Config(),
      newPage: async () => page,
    } as unknown as BrowserInstance;

    let settled = false;
    const pending = route
      .handler(
        makeRequest({ html: '<h1>Hello</h1>' }),
        res,
        new Logger('pdf-cleanup'),
        browser,
      )
      .then(() => {
        settled = true;
      });

    await settle();

    // The pdf bytes were already streamed, so the handler must have reached
    // its finally block and started closing the page ...
    expect(page.closeCalled).to.be.true;
    // ... but it must not resolve while that close is still in flight.
    // Returning early races the browser shutdown in
    // BrowserManager.complete() and strands targets on every request.
    expect(settled).to.be.false;

    releaseClose();
    await pending;
    expect(settled).to.be.true;
    expect(res.writableEnded).to.be.true;
  });
});
