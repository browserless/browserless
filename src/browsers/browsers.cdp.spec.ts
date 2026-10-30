import {
  BrowserLauncherOptions,
  Config,
  HTTPServer,
  Logger,
  NetworkRangeSet,
  Request,
  availableBrowsers,
  isSocketProxied,
} from '@browserless.io/browserless';
import { Server, createServer } from 'http';
import {
  AddressInfo,
  Socket,
  connect,
  createServer as createNetServer,
} from 'net';
import { EventEmitter, once } from 'events';
import { PassThrough } from 'stream';
import { fork } from 'child_process';
import { expect } from 'chai';
import { chromium } from 'playwright-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import puppeteer, { Page } from 'puppeteer-core';
import sinon from 'sinon';
import WebSocket, { WebSocketServer } from 'ws';

import { ChromiumCDP } from './browsers.cdp.js';

describe('CDP context admission transport', () => {
  it('forwards an admitted message larger than Chromium’s receive buffer', async function () {
    this.timeout(60000);
    if (!fs.existsSync(chromium.executablePath())) this.skip();
    const realBrowser = await puppeteer.launch({
      executablePath: chromium.executablePath(),
      args: ['--no-sandbox'],
    });
    class LargeConfig extends Config {
      getCdpMaxInboundPayload() {
        return 128 * 1024 * 1024;
      }
      getCDPContextPolicy() {
        return () => {};
      }
    }
    const browser = new ChromiumCDP({
      config: new LargeConfig(),
      logger: new Logger('large-frame'),
      blockAds: false,
      userDataDir: null,
    });
    browser['browserWSEndpoint'] = realBrowser.wsEndpoint();
    browser['browser'] = new EventEmitter() as never;
    const server = createServer();
    const bridges: Promise<void>[] = [];
    server.on('upgrade', (req, socket, head) => {
      const request = req as Request;
      request.parsed = new URL(req.url!, 'http://localhost');
      const bridge = browser.proxyWebSocket(request, socket, head);
      bridges.push(bridge);
      bridge.catch(() => socket.destroy());
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const client = new WebSocket(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    try {
      await once(client, 'open');
      const response = Promise.race([
        once(client, 'message'),
        once(client, 'close').then(() => {
          throw new Error('admitted message closed the transport');
        }),
      ]);
      // Chromium ignores unknown parameters, but still has to receive and parse
      // the entire message before it can return its version.
      const prefix =
        '{"id":1,"method":"Browser.getVersion","params":{"padding":"';
      // Split a three-byte UTF-8 character across the upstream frame boundary.
      const message =
        prefix +
        'x'.repeat(64 * 1024 * 1024 - Buffer.byteLength(prefix) - 1) +
        '€' +
        'x'.repeat(46 * 1024 * 1024) +
        '"}}';
      expect(
        Buffer.from(message)
          .subarray(64 * 1024 * 1024 - 1, 64 * 1024 * 1024 + 2)
          .toString(),
      ).to.equal('€');
      client.send(message);
      const [data] = await response;
      const frame = JSON.parse(data.toString());
      expect(frame.id).to.equal(1);
      expect(frame.result.product).to.be.a('string');
    } finally {
      client.terminate();
      await Promise.allSettled(bridges);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await realBrowser.close();
    }
  });

  for (const mode of ['echo', 'client-close', 'upstream-close']) {
    it(`preserves large binary messages, ordering and cleanup (${mode})`, async function () {
      this.timeout(30000);
      class LargeConfig extends Config {
        getCdpMaxInboundPayload() {
          return 128 * 1024 * 1024;
        }
        getCDPContextPolicy() {
          return () => {};
        }
      }
      const upstream = new WebSocketServer({
        port: 0,
        host: '127.0.0.1',
        maxPayload: 0,
      });
      await once(upstream, 'listening');
      const browser = new ChromiumCDP({
        config: new LargeConfig(),
        logger: new Logger('fragment-cleanup'),
        blockAds: false,
        userDataDir: null,
      });
      const lifecycle = new EventEmitter();
      browser['browser'] = lifecycle as never;
      browser['browserWSEndpoint'] =
        `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      const bridges: Promise<void>[] = [];
      const server = createServer();
      server.on('upgrade', (req, socket, head) => {
        const request = req as Request;
        request.parsed = new URL(req.url!, 'http://localhost');
        const bridge = browser.proxyWebSocket(request, socket, head);
        bridges.push(bridge);
        bridge.catch(() => socket.destroy());
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const client = new WebSocket(
        `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      );
      upstream.on('connection', (ws, req) => {
        if (mode !== 'echo')
          req.socket.once('data', () => {
            if (mode === 'client-close') client.terminate();
            else ws.terminate();
          });
        ws.on('error', () => {});
        ws.on('message', (data, binary) => ws.send(data, { binary }));
      });
      try {
        await once(client, 'open');
        const closed = once(client, 'close');
        const expected = Buffer.from(
          JSON.stringify({
            method: 'large',
            value: 'x'.repeat(70 * 1024 * 1024),
          }),
        );
        const received: { data: Buffer; binary: boolean }[] = [];
        const echoed = new Promise<void>((resolve) =>
          client.on('message', (data, binary) => {
            received.push({ data: data as Buffer, binary });
            if (received.length === 2) resolve();
          }),
        );
        client.send(expected, { binary: true });
        client.send('{}');
        if (mode === 'echo') {
          await echoed;
          expect(received[0].data.equals(expected)).to.equal(true);
          expect(received[0].binary).to.equal(true);
          expect(received[1].data.toString()).to.equal('{}');
          expect(received[1].binary).to.equal(false);
          client.close();
        }
        await closed;
        await Promise.allSettled(bridges);
        expect(lifecycle.listenerCount('close')).to.equal(0);
      } finally {
        client.terminate();
        upstream.clients.forEach((ws) => ws.terminate());
        await Promise.allSettled(bridges);
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }

  it('isolates configured connection limits and counts fragmented messages at the exact boundary', async () => {
    class LimitedConfig extends Config {
      constructor(private limit: number) {
        super();
      }
      getCdpMaxInboundPayload() {
        return this.limit;
      }
      getCDPContextPolicy() {
        return () => {};
      }
    }
    const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(upstream, 'listening');
    upstream.on('connection', (ws) =>
      ws.on('message', (data) => ws.send(data)),
    );
    const browsers = [512, 2048, NaN].map((limit) => {
      const browser = new ChromiumCDP({
        config: new LimitedConfig(limit),
        logger: new Logger('payload'),
        blockAds: false,
        userDataDir: null,
      });
      browser['browserWSEndpoint'] =
        `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      browser['browser'] = new EventEmitter() as never;
      return browser;
    });
    const server = createServer();
    const bridges: Promise<void>[] = [];
    const clients: WebSocket[] = [];
    const errorServer = new HTTPServer(
      new Config(),
      null as never,
      null as never,
      {
        getRouteForWebSocketRequest: async () => ({
          auth: false,
          name: 'invalid-override',
          handler: (req: Request, socket: Socket, head: Buffer) => {
            const bridge = browsers[2].proxyWebSocket(req, socket, head);
            bridges.push(bridge);
            return bridge;
          },
        }),
      } as never,
      { before: async () => true } as never,
      Logger,
    );
    server.on('upgrade', (req, socket, head) => {
      if (req.url!.endsWith('invalid')) {
        void errorServer['handleUpgrade'](req, socket, head);
        return;
      }
      const request = req as Request;
      request.parsed = new URL(req.url!, 'http://localhost');
      const browser = browsers[req.url!.endsWith('high') ? 1 : 0];
      const bridge = req.url!.includes('/page/')
        ? browser.proxyPageWebSocket(request, socket, head)
        : browser.proxyWebSocket(request, socket, head);
      bridges.push(bridge);
      bridge.catch(() => socket.destroy());
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      for (const fragmented of [false, true]) {
        const pair = ['low', 'high'].map(
          (name) =>
            new WebSocket(
              `ws://127.0.0.1:${(server.address() as AddressInfo).port}/${fragmented ? 'devtools/page/' : ''}${name}`,
            ),
        );
        clients.push(...pair);
        await Promise.all(pair.map((client) => once(client, 'open')));
        // Both configurations are live: a shared mutable server cap would break one.
        for (const [index, limit] of [
          [1, 2048],
          [0, 512],
        ]) {
          const client = pair[index];
          const frame = JSON.stringify({ id: 1, method: 'test', padding: '' });
          const exact = frame.replace(
            '"padding":""',
            `"padding":"${'x'.repeat(limit - frame.length)}"`,
          );
          expect(Buffer.byteLength(exact)).to.equal(limit);
          const echoed = once(client, 'message');
          if (fragmented) {
            client.send(exact.slice(0, 200), { fin: false });
            client.send(exact.slice(200), { fin: true });
          } else client.send(exact);
          expect((await echoed)[0].toString()).to.equal(exact);
        }
        for (const [index, limit] of [
          [0, 512],
          [1, 2048],
        ]) {
          const client = pair[index];
          const closed = once(client, 'close');
          const rejected = once(client, 'message').then(() => 'forwarded');
          const oversized = JSON.stringify({ padding: 'x'.repeat(limit - 13) });
          expect(Buffer.byteLength(oversized)).to.equal(limit + 1);
          if (fragmented) {
            client.send(oversized.slice(0, 200), { fin: false });
            client.send(oversized.slice(200), { fin: true });
          } else client.send(oversized);
          expect(
            await Promise.race([closed.then(([code]) => code), rejected]),
          ).to.equal(1009);
        }
      }
      const invalid = new WebSocket(
        `ws://127.0.0.1:${(server.address() as AddressInfo).port}/invalid`,
      );
      clients.push(invalid);
      let rejectedUpgrade = '';
      invalid.on('error', (error) => {
        rejectedUpgrade = error.message;
      });
      await new Promise<void>((resolve) =>
        invalid.once('close', () => resolve()),
      );
      expect(rejectedUpgrade).to.include('500');
      const error = await bridges.at(-1)!.catch((error) => error);
      expect(error)
        .to.be.instanceOf(Error)
        .with.property('message')
        .that.includes('CDP_MAX_INBOUND_PAYLOAD');
    } finally {
      clients.forEach((client) => client.terminate());
      await Promise.allSettled(bridges);
      upstream.clients.forEach((client) => client.terminate());
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  for (const variant of [
    'plain',
    'line comment',
    'block comment',
    'control character',
  ]) {
    it(`checks context admission before Chromium receives ${variant} frames`, async function () {
      if (!fs.existsSync(chromium.executablePath())) this.skip();
      let hits = 0;
      const trap = createNetServer((socket) => {
        hits++;
        socket.destroy();
      });
      await new Promise<void>((resolve) =>
        trap.listen(0, '127.0.0.1', resolve),
      );
      const realBrowser = await puppeteer.launch({
        executablePath: chromium.executablePath(),
        args: ['--no-sandbox'],
      });
      class RestrictedConfig extends Config {
        getCDPContextPolicy() {
          return async () => {
            throw new Error('denied');
          };
        }
      }
      const browser = new ChromiumCDP({
        config: new RestrictedConfig(),
        logger: new Logger('frame-policy'),
        blockAds: false,
        userDataDir: null,
      });
      browser['browserWSEndpoint'] = realBrowser.wsEndpoint();
      browser['browser'] = new EventEmitter() as never;
      const server = createServer();
      let bridge: Promise<void> | undefined;
      server.on('upgrade', (req, socket, head) => {
        const request = req as Request;
        request.parsed = new URL(req.url!, 'http://localhost');
        bridge = browser.proxyWebSocket(request, socket, head);
        bridge.catch(() => {});
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const client = new WebSocket(
        `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      );
      try {
        await once(client, 'open');
        const response = Promise.race([
          once(client, 'message').then(([data]) => JSON.parse(data.toString())),
          once(client, 'close').then(() => null),
        ]);
        let frame = JSON.stringify({
          id: 1,
          method: 'Target.createBrowserContext',
          params: {
            proxyServer: `http://127.0.0.1:${(trap.address() as AddressInfo).port}`,
          },
        });
        if (variant === 'line comment')
          frame = frame.replace('"params"', '// comment\n"params"');
        if (variant === 'block comment')
          frame = frame.replace('"params"', '/* comment */"params"');
        if (variant === 'control character')
          frame = frame.replace(
            '"params":{',
            '"params":{"ignored":"line\nbreak",',
          );
        client.send(frame);
        const reply = await response;
        if (reply?.result?.browserContextId) {
          client.send(
            JSON.stringify({
              id: 2,
              method: 'Target.createTarget',
              params: {
                browserContextId: reply.result.browserContextId,
                url: 'http://fixture.invalid/',
              },
            }),
          );
          const until = Date.now() + 3000;
          while (!hits && Date.now() < until)
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(hits, 'denied frames must not connect to the proxy').to.equal(0);
        expect(
          reply?.result?.browserContextId,
          'context must not be created',
        ).to.equal(undefined);
        if (variant !== 'plain')
          expect(
            reply,
            'invalid frames must close before browser parsing',
          ).to.equal(null);
      } finally {
        client.terminate();
        await bridge;
        await realBrowser.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await new Promise<void>((resolve) => trap.close(() => resolve()));
      }
    });
  }

  for (const mode of [
    'browser',
    'page',
    'page-graceful',
    'oversized',
    'queue-overflow',
    'configured-queue-overflow',
  ]) {
    const pageConnection = mode.startsWith('page');
    it(`preserves commands and denies contexts before forwarding (${mode})`, async () => {
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      class RestrictedConfig extends Config {
        getCdpMaxInboundPayload() {
          return mode === 'configured-queue-overflow' ? 4096 : undefined;
        }
        getCDPContextPolicy() {
          return async (options: Readonly<Record<string, unknown>>) => {
            if (options.proxyServer === 'direct://') throw new Error('secret');
            if (options.proxyServer === 'wait') {
              entered();
              await gate;
            }
          };
        }
      }
      const upstream = new WebSocketServer({
        port: 0,
        host: '127.0.0.1',
        maxPayload: 0,
        perMessageDeflate: true,
      });
      await once(upstream, 'listening');
      const forwarded: unknown[] = [];
      let upstreamExtensions: string | undefined;
      upstream.on('connection', (ws) => {
        upstreamExtensions = ws.extensions;
        ws.on('message', (data, binary) => {
          const command = JSON.parse(data.toString());
          forwarded.push(command);
          if (command.method === 'test.large')
            return ws.send(Buffer.alloc(101 * 1024 * 1024, 'a'));
          if (command.method === 'test.close')
            return ws.close(1001, 'fixture complete');
          ws.send(data, { binary });
        });
      });
      const browser = new ChromiumCDP({
        blockAds: false,
        config: new RestrictedConfig(),
        logger: new Logger('cdp-admission'),
        userDataDir: null,
      });
      browser['browserWSEndpoint'] =
        `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      browser['browser'] = new EventEmitter() as never;
      const server = createServer();
      let bridge: Promise<void> | undefined;
      server.on('upgrade', (req, socket, head) => {
        const request = req as Request;
        request.parsed = new URL(req.url!, 'http://localhost');
        const connection = pageConnection
          ? browser.proxyPageWebSocket(request, socket, head)
          : browser.proxyWebSocket(request, socket, head);
        bridge ??= connection;
        connection.catch(() => {});
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const client = new WebSocket(
        `ws://127.0.0.1:${(server.address() as AddressInfo).port}/devtools/page/test`,
        { maxPayload: 0 },
      );
      try {
        await once(client, 'open');
        for (const [method, depth] of [
          ['Target.createBrowserContext', 0],
          ['Target.createBrowserContext', 1],
          ['Target.createBrowserContext', 2],
          ['Target.exposeDevToolsProtocol', 0],
          ['Target.exposeDevToolsProtocol', 1],
          ['Target.exposeDevToolsProtocol', 2],
        ] as const) {
          const command = {
            id: 12,
            method,
            params:
              method === 'Target.createBrowserContext'
                ? { proxyServer: 'direct://' }
                : { targetId: 'page' },
          };
          let frame: Record<string, unknown> = command;
          for (let level = 0; level < depth; level++) {
            frame = {
              id: 13 + level,
              method: 'Target.sendMessageToTarget',
              params: {
                sessionId: `s${level}`,
                message: JSON.stringify(frame),
              },
            };
          }
          frame.sessionId = 'flat-session';
          if (depth) {
            const nestedClient = new WebSocket(client.url);
            try {
              await once(nestedClient, 'open');
              const result = Promise.race([
                once(nestedClient, 'close').then(([code]) => code),
                once(nestedClient, 'message').then(() => 'outer response only'),
              ]);
              nestedClient.send(JSON.stringify(frame));
              expect(await result).to.equal(1008);
              expect(forwarded).to.deep.equal([]);
            } finally {
              nestedClient.terminate();
            }
            continue;
          }
          const response = once(client, 'message');
          client.send(JSON.stringify(frame));
          const [data] = await response;
          const parsed = JSON.parse(data.toString());
          expect(parsed.id).to.equal(frame.id);
          expect(parsed.sessionId).to.equal('flat-session');
          expect(parsed.error?.message).to.equal(
            'CDP context policy rejected configuration',
          );
          expect(forwarded).to.deep.equal([]);
        }
        for (const command of [
          {
            id: 20,
            method: 'Target.createBrowserContext',
            params: { proxyServer: 'http://proxy.example:8080' },
          },
          { id: 21, method: 'Browser.getBrowserCommandLine' },
          {
            id: 22,
            method: 'Page.setDownloadBehavior',
            params: { behavior: 'allow', downloadPath: '/tmp/unique-download' },
            sessionId: 'page',
          },
        ]) {
          const response = once(client, 'message');
          client.send(JSON.stringify(command));
          const [data] = await response;
          expect(JSON.parse(data.toString())).to.deep.equal(command);
        }
        expect(forwarded).to.have.length(3);
        expect(upstreamExtensions).to.equal('');
        if (mode === 'browser') {
          for (const delayed of [false, true]) {
            const count = delayed ? 50_000 : 600;
            const received: number[] = [];
            const onMessage = (data: WebSocket.RawData) => {
              received.push(JSON.parse(data.toString()).id);
            };
            client.on('message', onMessage);
            const start = forwarded.length;
            if (delayed) {
              client.send(
                JSON.stringify({
                  id: 99,
                  method: 'Target.createBrowserContext',
                  params: { proxyServer: 'wait' },
                }),
              );
              await waiting;
            }
            for (let id = 100; id < 100 + count; id++) {
              client.send(JSON.stringify({ id, method: 'Browser.getVersion' }));
            }
            if (delayed) {
              await new Promise((resolve) => setTimeout(resolve, 50));
              expect(forwarded.length).to.equal(start);
              release();
            }
            const expected = [
              ...(delayed ? [99] : []),
              ...Array.from({ length: count }, (_, i) => i + 100),
            ];
            const until = Date.now() + 10000;
            while (
              received.length < expected.length &&
              client.readyState === WebSocket.OPEN &&
              Date.now() < until
            )
              await new Promise((resolve) => setTimeout(resolve, 10));
            client.off('message', onMessage);
            expect(received).to.deep.equal(expected);
            forwarded.splice(start);
          }
        }
        const largeResponse = Promise.race([
          once(client, 'message'),
          once(client, 'close').then(() => {
            throw new Error('Large response closed the connection');
          }),
        ]);
        client.send(JSON.stringify({ id: 40, method: 'test.large' }));
        const [large] = await largeResponse;
        expect(large.length).to.equal(101 * 1024 * 1024);
        expect(large.equals(Buffer.alloc(large.length, 'a'))).to.equal(true);
        if (mode === 'oversized') {
          const rejected = Promise.race([
            once(client, 'close').then(([code]) => code),
            once(client, 'message').then(() => false),
          ]);
          client.send(
            JSON.stringify({
              method: 'test.oversized',
              padding: 'a'.repeat(100 * 1024 * 1024),
            }),
          );
          expect(
            await rejected,
            'oversized input must not reach the browser',
          ).to.equal(1009);
          expect(forwarded).to.have.length(4);
          return;
        }
        if (mode === 'browser') {
          const closing = once(client, 'close');
          client.send(JSON.stringify({ id: 41, method: 'test.close' }));
          const [code, reason] = await closing;
          expect(code).to.equal(1001);
          expect(reason.toString()).to.equal('fixture complete');
          return;
        }
        client.send(
          JSON.stringify({
            id: 30,
            method: 'Target.createBrowserContext',
            params: { proxyServer: 'wait' },
          }),
        );
        for (let id = 31; id < 41; id++)
          client.send(JSON.stringify({ id, method: 'Browser.getVersion' }));
        await waiting;
        expect(forwarded).to.have.length(4);
        if (mode.endsWith('queue-overflow')) {
          const closed = once(client, 'close');
          const payload = JSON.stringify({
            id: 50,
            method: 'test.payload',
            data: 'a'.repeat(
              mode === 'configured-queue-overflow' ? 2200 : 60 * 1024 * 1024,
            ),
          });
          client.send(payload);
          client.send(payload);
          expect((await closed)[0]).to.equal(1009);
        } else {
          // Let the bridge consume the chunk behind the asynchronous policy.
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (mode === 'page-graceful') client.close();
          else client.terminate();
        }
        expect(
          await Promise.race([
            bridge!.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
          ]),
          'disconnect must settle before the policy resolves',
        ).to.equal(true);
        release();
        await new Promise(setImmediate);
        expect(forwarded).to.have.length(4);
      } finally {
        release();
        client.terminate();
        await bridge;
        for (const ws of upstream.clients) ws.terminate();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
});

describe('ChromiumCDP launch args', function () {
  let browser: ChromiumCDP | undefined;

  // Single-browser images (chrome, edge, firefox, webkit) ship no chromium
  // binary, so this suite has nothing to launch there.
  before(async function () {
    const installed = await availableBrowsers;
    if (!installed.includes(ChromiumCDP)) {
      this.skip();
    }
  });

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
  });

  const launch = async ({
    args = [],
    stealth = false,
  }: { args?: string[]; stealth?: boolean } = {}) => {
    browser = new ChromiumCDP({
      blockAds: false,
      config: new Config(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    const launchOptions: BrowserLauncherOptions = {
      options: { args },
      stealth,
    };
    await browser.launch(launchOptions);
    return browser.process()?.spawnargs ?? [];
  };

  for (const { name, args, stealth, screen } of [
    { name: 'default', args: [], stealth: false, screen: [1920, 1080] },
    {
      name: 'larger window',
      args: ['--window-size=2560,1440'],
      stealth: false,
      screen: [2560, 1440],
    },
    {
      name: 'explicit screen',
      args: ['--screen-info={1280x720}'],
      stealth: false,
      screen: [1280, 720],
    },
    { name: 'stealth', args: [], stealth: true, screen: [1920, 1080] },
  ]) {
    it(`uses the expected headless screen for ${name}`, async () => {
      const spawnargs = await launch({ args, stealth });
      const page = await browser!.newPage();
      await page.setViewport({ width: 1280, height: 1024 });
      expect(
        await page.evaluate(() => [
          window.screen.width,
          window.screen.height,
          matchMedia('(max-device-width: 800px)').matches,
        ]),
      ).to.deep.equal([...screen, false]);
      expect(
        spawnargs.filter((arg) => arg.startsWith('--screen-info')),
      ).to.deep.equal([`--screen-info={${screen[0]}x${screen[1]}}`]);
    });
  }

  it('disables the component updater', async function () {
    const spawnargs = await launch();

    expect(spawnargs).to.include('--disable-component-update');
  });

  it('keeps disabling it when the caller supplies its own args', async function () {
    const spawnargs = await launch({ args: ['--window-size=800,600'] });

    expect(spawnargs).to.include('--disable-component-update');
    expect(spawnargs).to.include('--window-size=800,600');
  });

  it('closes once when a close listener closes the browser again', async () => {
    await launch();
    const inner = (await browser!.newPage()).browser();
    const close = inner.close.bind(inner);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sinon.stub(inner, 'close').callsFake(async () => {
      await gate;
      await close();
    });
    let closeEvents = 0;
    let nestedFinished = false;
    let nestedClose: Promise<void> | undefined;
    browser!.on('close', () => closeEvents++);
    browser!.once('close', () => {
      nestedClose = browser!.close().then(() => {
        nestedFinished = true;
      });
    });

    const outerClose = browser!.close();
    try {
      await new Promise(setImmediate);
      expect(closeEvents).to.equal(1);
      expect(nestedFinished).to.be.false;
    } finally {
      release();
      await outerClose;
    }
    await nestedClose;
    expect(nestedFinished).to.be.true;
    expect(closeEvents).to.equal(1);
    expect(browser!.isRunning()).to.be.false;
    await browser!.close();
    expect(closeEvents).to.equal(1);
  });

  for (const shutdown of ['close', 'SIGTERM', 'SIGINT', 'SIGHUP']) {
    it(`flushes a persistent profile before ${shutdown} completes`, async function () {
      // Windows child.kill() terminates without running signal handlers.
      if (process.platform === 'win32' && shutdown !== 'close') this.skip();
      this.timeout(30000);
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-close-'));
      const child = fork(new URL('../exports.js', import.meta.url), [], {
        execArgv: [
          '--input-type=module',
          '--eval',
          `
            import { ChromiumCDP, Config, Logger } from ${JSON.stringify(new URL('../exports.js', import.meta.url).href)};
            const browser = new ChromiumCDP({
              config: new Config(), logger: new Logger('profile-close'),
              blockAds: false, userDataDir: ${JSON.stringify(userDataDir)},
            });
            const close = async () => { await browser.close(); process.exit(0); };
            process.once('message', close);
            for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, close);
            const inner = await browser.launch({ options: {}, stealth: false });
            await inner.defaultBrowserContext().setCookie({
              name: 'persisted', value: 'graceful', domain: 'example.test', path: '/',
              expires: Math.floor(Date.now() / 1000) + 3600,
            });
            process.send('ready');
          `,
        ],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      let stderr = '';
      child.stderr!.on('data', (data) => {
        stderr += data;
      });
      const exited = once(child, 'exit');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 20000);
      try {
        await Promise.race([
          once(child, 'message'),
          exited.then(() => {
            throw new Error(`child exited before launch: ${stderr}`);
          }),
        ]);
        if (shutdown === 'close') child.send('close');
        else child.kill(shutdown as NodeJS.Signals);
        expect(await exited, stderr).to.deep.equal([0, null]);
        browser = new ChromiumCDP({
          config: new Config(),
          logger: new Logger('profile-recovery'),
          blockAds: false,
          userDataDir,
        });
        const recovered = await browser.launch({ options: {}, stealth: false });
        const cookies = await recovered.defaultBrowserContext().cookies();
        expect(
          cookies.map(({ name, value }) => ({ name, value })),
        ).to.deep.equal([{ name: 'persisted', value: 'graceful' }]);
      } finally {
        clearTimeout(deadline);
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGKILL');
        await exited;
        await browser?.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  }

  it('closes a paused client socket with unread data when the browser exits', async () => {
    await launch();
    const server = createServer();
    let socket: Socket | undefined;
    let client: Socket | undefined;
    let proxying: Promise<void> | undefined;
    server.on('upgrade', (req, incoming, head) => {
      socket = incoming as Socket;
      const request = req as Request;
      request.parsed = new URL(req.url!, 'http://localhost');
      proxying = browser!.proxyWebSocket(request, socket, head);
    });

    try {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      client = connect({
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        allowHalfOpen: true,
      });
      client.write(
        'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\n' +
          'Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
      const [response] = await once(client, 'data');
      expect(response.toString()).to.include('101 Switching Protocols');

      // Model http-proxy unpiping its client readable during backend teardown.
      // A masked, empty WebSocket ping remains unread before the client's FIN.
      socket!.unpipe();
      socket!.pause();
      const readable = once(socket!, 'readable');
      client.end(Buffer.from([0x89, 0x80, 0, 0, 0, 0]));
      await readable;
      socket!.pause();
      expect(socket!.isPaused()).to.equal(true);
      expect(socket!.readableLength).to.be.greaterThan(0);

      await browser!.close();
      await proxying;
      expect(socket!.destroyed).to.equal(true);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      client?.destroy();
      socket?.destroy();
      server.close();
    }
  });

  // puppeteer-extra's stealth launcher is a separate code path that rebuilds the
  // argv, so the switch has to be asserted through it too.
  it('disables the component updater on the stealth launcher', async function () {
    const spawnargs = await launch({ stealth: true });

    expect(spawnargs).to.include('--disable-component-update');
  });

  for (const method of ['GET', 'POST']) {
    it(`releases a new page when its ${method} client socket is already closed`, async () => {
      await launch();
      const socket = new Socket();
      socket.destroy();
      const pageClosed = new Promise<void>((resolve) =>
        browser!['browser']!.once('targetdestroyed', () => resolve()),
      );
      const request = {
        method,
        url: '/devtools/page/BLESS',
        parsed: new URL('http://localhost/devtools/page/BLESS'),
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      } as Request;
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.all([
            browser!.proxyPageWebSocket(request, socket, Buffer.alloc(0)),
            pageClosed,
          ]),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Aborted page proxy did not settle and release its page',
                  ),
                ),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  it('removes an unused backend listener before another request can consume it', async () => {
    await launch();
    const page = await browser!.newPage();
    const socket = new Socket();
    const pathname = `/devtools/page/${browser!.getPageId(page)}`;
    const request = {
      method: 'POST',
      url: pathname,
      parsed: new URL(pathname, 'http://localhost'),
      headers: { upgrade: 'websocket' },
    } as Request;
    // The shared proxy keeps one persistent proxyReqWs listener (see the
    // constructor), so compare against the count before this request runs
    // rather than expecting zero.
    const baseline = browser!['proxy'].listenerCount('proxyReqWs');
    const pending = browser!.proxyPageWebSocket(
      request,
      socket,
      Buffer.alloc(0),
    );
    try {
      // Rejection destroys the socket, but its close event runs next tick.
      // This request must not leave its own listener behind.
      expect(browser!['proxy'].listenerCount('proxyReqWs')).to.equal(baseline);
    } finally {
      socket.destroy();
      await pending;
    }
  });

  it('keeps a concurrent page proxy usable when the other page closes', async () => {
    await launch();
    const pages = await Promise.all([browser!.newPage(), browser!.newPage()]);
    const server = createServer();
    const pending: Promise<void>[] = [];
    const clients: WebSocket[] = [];
    server.on('upgrade', (req, socket, head) => {
      const request = req as Request;
      request.parsed = new URL(req.url!, 'http://localhost');
      pending.push(browser!.proxyPageWebSocket(request, socket, head));
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const port = (server.address() as AddressInfo).port;
      for (const page of pages) {
        clients.push(
          new WebSocket(
            `ws://127.0.0.1:${port}/devtools/page/${browser!.getPageId(page)}`,
          ),
        );
      }
      await Promise.all(clients.map((client) => once(client, 'open')));
      const firstClosed = once(clients[0], 'close');
      await pages[0].close();
      await firstClosed;
      expect(clients[1].readyState).to.equal(WebSocket.OPEN);
      expect(pages[1].isClosed()).to.equal(false);
      const response = once(clients[1], 'message');
      clients[1].send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: '6 * 7', returnByValue: true },
        }),
      );
      expect(
        JSON.parse((await response)[0].toString()).result.result.value,
      ).to.equal(42);
    } finally {
      clients.forEach((client) => client.terminate());
      await Promise.all(pending);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  for (const pageKind of ['created', 'existing']) {
    for (const shutdown of ['browser', 'process', 'page', 'client']) {
      // A client-only disconnect has no backend teardown/unpipe to model.
      for (const paused of shutdown === 'client' ? [false] : [false, true]) {
        it(`closes a ${paused ? 'paused' : 'flowing'} ${pageKind}-page proxy after ${shutdown} shutdown`, async () => {
          await launch();
          const existing = await browser!.newPage();
          const before = await browser!.pages();
          const pathname = `/devtools/page/${pageKind === 'created' ? 'BLESS' : browser!.getPageId(existing)}`;
          const server = createServer();
          let socket: Socket | undefined;
          let client: Socket | undefined;
          let proxying: Promise<void> | undefined;
          let timer: NodeJS.Timeout | undefined;
          server.on('upgrade', (req, incoming, head) => {
            socket = incoming as Socket;
            const request = req as Request;
            request.parsed = new URL(req.url!, 'http://localhost');
            proxying = browser!.proxyPageWebSocket(request, socket, head);
          });

          try {
            await new Promise<void>((resolve) =>
              server.listen(0, '127.0.0.1', resolve),
            );
            client = connect({
              host: '127.0.0.1',
              port: (server.address() as AddressInfo).port,
              allowHalfOpen: true,
            });
            client.write(
              `GET ${pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\n` +
                'Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
            );
            const [response] = await once(client, 'data');
            expect(response.toString()).to.include('101 Switching Protocols');
            const page =
              pageKind === 'existing'
                ? existing
                : (await browser!.pages()).find(
                    (page) => !before.includes(page),
                  )!;
            expect(page).not.to.equal(undefined);
            expect(socket!.isPaused()).to.equal(false);

            if (paused) {
              // Deterministically reproduce the unread state left by unpiping.
              socket!.unpipe();
              socket!.pause();
              const readable = once(socket!, 'readable');
              client.end(Buffer.from([0x89, 0x80, 0, 0, 0, 0]));
              await readable;
              socket!.pause();
              expect(socket!.readableLength).to.be.greaterThan(0);
            }

            const pageClosed =
              shutdown === 'client' && pageKind === 'created'
                ? new Promise<void>((resolve) =>
                    page.once('close', () => resolve()),
                  )
                : undefined;
            if (shutdown === 'client') client.destroy();
            if (shutdown === 'browser') await browser!.close();
            if (shutdown === 'page') await page.close();
            if (shutdown === 'process') {
              const process = browser!.process()!;
              const exited = once(process, 'close');
              process.kill('SIGKILL');
              await exited;
            }
            const serverClosed = new Promise<void>((resolve) =>
              server.close(() => resolve()),
            );
            await Promise.race([
              Promise.all([proxying, serverClosed]),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Page proxy did not settle: destroyed=${socket!.destroyed}, paused=${socket!.isPaused()}, unread=${socket!.readableLength}`,
                      ),
                    ),
                  2000,
                );
              }),
            ]);
            expect(socket!.destroyed).to.equal(true);
            await pageClosed;
            if (shutdown === 'client' && pageKind === 'existing') {
              expect(await page.evaluate(() => 6 * 7)).to.equal(42);
            }
            if (shutdown === 'page') {
              expect(await before[0].evaluate(() => 6 * 7)).to.equal(42);
            }
          } finally {
            clearTimeout(timer);
            client?.destroy();
            socket?.destroy();
            server.close();
          }
        });
      }
    }
  }
});

describe('ChromiumCDP blocked-URL guard', function () {
  let browser: ChromiumCDP | undefined;
  let server: Server | undefined;
  let proxy: Server | undefined;
  let port = 0;
  let proxyPort = 0;
  let proxyChallenges = 0;
  let hits: string[] = [];

  // A range set mirroring what a consumer opts into: loopback plus localhost.
  // The default OSS Config returns null (guard off), so the ranges have to come
  // from a subclass for these to exercise anything.
  class GuardedConfig extends Config {
    public getBlockedNetworkRanges(): NetworkRangeSet {
      return {
        hostnames: ['localhost'],
        ipv4Prefixes: ['127.', '169.254.'],
        ipv6Prefixes: ['::1'],
        protocols: [],
      };
    }
  }

  before(async function () {
    const installed = await availableBrowsers;
    if (!installed.includes(ChromiumCDP)) {
      this.skip();
    }
  });

  beforeEach(async () => {
    hits = [];
    proxyChallenges = 0;
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      // A 401 endpoint for the page.authenticate() cases; everything else is
      // an image, which is the shape the blocked sub-resource cases use.
      if (req.url?.startsWith('/auth')) {
        if (!req.headers.authorization) {
          res.writeHead(401, {
            'content-type': 'text/html',
            'www-authenticate': 'Basic realm="probe"',
          });
          return res.end('<html><body>denied</body></html>');
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html><body>authed</body></html>');
      }
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    port = (server!.address() as AddressInfo).port;

    // A proxy that challenges once, so a 407 has to reach the client the same
    // way a 401 does. Chromium sends absolute-form requests to a proxy, so
    // nothing here has to resolve the name it is asked for.
    proxy = createServer((req, res) => {
      if (!req.headers['proxy-authorization']) {
        proxyChallenges++;
        res.writeHead(407, {
          'content-type': 'text/html',
          'proxy-authenticate': 'Basic realm="probe"',
        });
        return res.end('<html><body>proxy denied</body></html>');
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>authed</body></html>');
    });
    await new Promise<void>((resolve) =>
      proxy!.listen(0, '127.0.0.1', resolve),
    );
    proxyPort = (proxy!.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await browser?.close();
    browser = undefined;
    server?.close();
    server = undefined;
    proxy?.close();
    proxy = undefined;
  });

  // Positive assertions ("the request did happen", "the session did close")
  // race the browser: the fetch, the guard install and renderer scheduling all
  // have to land first, and a loaded CI box can take longer than any fixed
  // sleep. Negative assertions stay on a flat wait — there is nothing to poll
  // for when the expected outcome is that nothing happens.
  const waitFor = async (
    predicate: () => boolean,
    timeoutMS = 10_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMS;
    while (Date.now() < deadline && !predicate()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const launchGuarded = async (
    args: string[] = [],
    config: Config = new GuardedConfig(),
  ) => {
    browser = new ChromiumCDP({
      blockAds: false,
      config,
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args }, stealth: false });
    return browser;
  };

  // Resolves every hostname to the probe server, so a case can use a name the
  // blocklist has an opinion about — or a lookalike it must not — and still be
  // served locally.
  const resolveEverythingLocally = () => [
    `--host-resolver-rules=MAP * 127.0.0.1:${port}`,
  ];

  const newGuardedPage = async (
    args: string[] = [],
    config: Config = new GuardedConfig(),
  ) => {
    await launchGuarded(args, config);
    const page = await browser!.newPage();
    // 'targetcreated' fires the guard install asynchronously, so newPage() can
    // resolve before the blocklist is live.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return page;
  };

  // https://careers.kinly.com/o/av-event-technician-38 — a job description
  // pasted out of Word, leaving the clipboard image behind. Chromium refuses
  // the scheme anyway; this used to cost the customer the whole session.
  it('survives a Word-pasted file:// image', async () => {
    const page = await newGuardedPage();

    await page.setContent(
      '<img src="file:///C:/Users/ANICHO~1/AppData/Local/Temp/msohtmlclip1/04/clip_image001.png">',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(browser!.isRunning()).to.be.true;
    expect(await page.evaluate(() => 1 + 1)).to.equal(2);
  });

  // https://fopconsultants.com/en/jobs/… — WordPress migrated off a local MAMP
  // install with the dev URL still in the content. Unlike file://, this request
  // does leave the browser, so the guard has to actually stop it.
  it('blocks a stale localhost image without ending the session', async () => {
    const page = await newGuardedPage();

    await page.setContent(
      `<img src="http://127.0.0.1:${port}/wordpress/wp-content/uploads/svg/world-map.svg">`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(hits, 'blocked request must not reach the destination').to.be.empty;
    expect(browser!.isRunning()).to.be.true;
    expect(await page.evaluate(() => 1 + 1)).to.equal(2);
  });

  // `Network.setBlockedURLs` has no notion of an exemption, so the carve-out
  // has to be baked into the patterns (toBlockedUrlPatterns). Without it the
  // pages browserless serves itself — the /function runtime and its code —
  // stop loading, and blocking beats interception to the request, so the
  // handler that serves them never gets the chance.
  it("still allows the server's own origin through the same host", async () => {
    class SelfHostedConfig extends GuardedConfig {
      public getSelfNavigationHosts(): string[] {
        return [`127.0.0.1:${port}`];
      }
    }

    browser = new ChromiumCDP({
      blockAds: false,
      config: new SelfHostedConfig(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args: [] }, stealth: false });
    const page = await browser.newPage();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await page.setContent(`<img src="http://127.0.0.1:${port}/runtime.svg">`);
    await waitFor(() => hits.length > 0);

    expect(hits, 'self-origin request must not be blocked').to.not.be.empty;
    expect(browser.isRunning()).to.be.true;
  });

  // The other half of the split: sub-resources are tolerated, but a navigation
  // to a blocked destination still ends the session. Without this, narrowing
  // `isNavigation` further — or dropping the teardown entirely — would pass the
  // rest of this suite.
  for (const target of ['file:///etc/passwd', 'http://169.254.169.254/']) {
    it(`still terminates the session on a navigation to ${target}`, async () => {
      const page = await newGuardedPage();

      // The teardown races the navigation, so goto can reject with a detached
      // frame, resolve, or hang until the browser goes — none of which is the
      // assertion. `isRunning()` is.
      await page.goto(target, { timeout: 10_000 }).catch(() => {});
      await waitFor(() => !browser!.isRunning());

      expect(browser!.isRunning(), 'blocked navigation must end the session').to
        .be.false;
    });
  }

  // Navigations are the one thing `Network.setBlockedURLs` does not apply to
  // (measured — sub-resources and renderer fetches are blocked, navigations
  // are not), so this is the observational teardown doing its job, not the
  // blocklist. The request does leave the browser; the route-level 403 and the
  // wire-protocol check are what stop the ones they can see, and a teardown
  // could never have unsent it anyway.
  it('still terminates a navigation that hides the host behind userinfo', async () => {
    const page = await newGuardedPage();

    await page
      .goto(`http://user:pass@127.0.0.1:${port}/nav`, { timeout: 10_000 })
      .catch(() => {});
    await waitFor(() => !browser!.isRunning());

    expect(browser!.isRunning(), 'blocked navigation must end the session').to
      .be.false;
  });

  // PLT-1596. The guard this replaced enabled `Fetch` on a second CDP session,
  // which swallowed the auth challenge for every request on the target: the
  // client was never asked for credentials and Chromium failed the navigation
  // with ERR_INVALID_AUTH_CREDENTIALS. It broke whether or not anything
  // matched the blocklist, and it took out ~5% of one customer's sessions.
  //
  // The client is a second puppeteer connection, as in production: the server
  // installs the guard on `targetcreated`, the customer drives a page over
  // their own connection.
  describe('with a client calling page.authenticate()', () => {
    const connectClient = async () => {
      const browserWSEndpoint = browser!.wsEndpoint();
      expect(browserWSEndpoint, 'browser should expose an endpoint').to.be.a(
        'string',
      );
      return puppeteer.connect({ browserWSEndpoint: browserWSEndpoint! });
    };

    // Three sequential pages: the original failure was a race between the
    // guard landing on the target and authenticate() arming, so one pass
    // proves less than a handful do.
    it('answers a site (401) challenge', async () => {
      // `auth.test` is deliberately not a name the blocklist covers: the
      // pre-fix guard broke auth even when nothing matched its patterns, and a
      // blocked host would confuse that with the navigation teardown.
      await launchGuarded(resolveEverythingLocally());
      const client = await connectClient();

      for (let attempt = 0; attempt < 3; attempt++) {
        const page = await client.newPage();
        // 'targetcreated' installs the guard asynchronously; give it the same
        // head start the pre-fix guard needed to lose this race.
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.authenticate({ password: 'pass', username: 'user' });

        const response = await page.goto('http://auth.test/auth', {
          timeout: 10_000,
        });

        expect(response?.status(), `attempt ${attempt}`).to.equal(200);
        expect(await page.evaluate(() => document.body.textContent)).to.equal(
          'authed',
        );
        await page.close();
      }

      await client.disconnect();
    });

    // The reported case: `/chrome?--proxy-server=…` with no credentials in the
    // flag, so the 407 has to reach the client's authenticate() too.
    it('answers a proxy (407) challenge', async () => {
      await launchGuarded([
        `--proxy-server=127.0.0.1:${proxyPort}`,
        // Chromium exempts loopback from proxying unless told otherwise.
        '--proxy-bypass-list=<-loopback>',
      ]);
      const client = await connectClient();
      const page = await client.newPage();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await page.authenticate({ password: 'pass', username: 'user' });

      const response = await page.goto('http://proxied.test/auth', {
        timeout: 10_000,
      });

      expect(response?.status()).to.equal(200);
      expect(
        proxyChallenges,
        'the proxy must have issued a challenge',
      ).to.be.greaterThan(0);
      await client.disconnect();
    });
  });

  // The patterns are the verdict now — nothing pauses to ask the matcher
  // afterwards — so a pattern that over-matches is a customer's sub-resource
  // that silently fails. This is the browser end of the anchoring asserted in
  // network-security.spec.ts: it also pins the assumption that Chromium
  // matches a pattern as an unanchored substring, which is what
  // matchesBlockedUrlPattern mirrors.
  it('leaves lookalike hosts alone', async () => {
    // Requested for real, rather than asserted against a re-implementation of
    // Chromium's matcher.
    const page = await newGuardedPage(resolveEverythingLocally());

    // 0.gravatar.com is the one that matters: an unanchored `0.` pattern
    // blocks it, and it sits on a great many WordPress sites.
    await page.setContent(
      '<img src="http://0.gravatar.test/avatar.svg">' +
        '<img src="http://localhostings.test/logo.svg">' +
        '<img src="http://127.example.test/logo.svg">',
    );
    const loaded = () => hits.filter((hit) => hit.endsWith('.svg')).length;
    await waitFor(() => loaded() >= 3);

    expect(loaded(), 'lookalike hosts must load').to.equal(3);
    expect(browser!.isRunning()).to.be.true;
  });

  it('allows numeric DNS labels without exempting blocked addresses', async () => {
    proxy!.removeAllListeners('request');
    proxy!.on('request', (req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });
    const page = await newGuardedPage([
      `--proxy-server=127.0.0.1:${proxyPort}`,
      '--proxy-bypass-list=<-loopback>',
    ]);
    const allowed = [
      'http://169.254.1.example.test/logo.svg',
      'http://127.0.0.1.example.test/path.1/',
      'http://public.test/control.svg',
    ];
    const blocked = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254/?host=example.test',
      `http://127.0.0.1:${port}/blocked.svg`,
      'http://sub.localhost:8888/blocked.svg',
    ];

    await page.evaluate(
      async (urls) => {
        await Promise.all(
          urls.map(
            (url) =>
              new Promise<void>((resolve) => {
                const image = new Image();
                image.onload = image.onerror = () => resolve();
                image.src = url;
              }),
          ),
        );
      },
      [...allowed, ...blocked],
    );

    expect(hits.filter((url) => allowed.includes(url))).to.have.members(
      allowed,
    );
    expect(hits.filter((url) => blocked.includes(url))).to.be.empty;
    expect(browser!.isRunning()).to.be.true;
  });

  for (const pattern of ['http://', 'http://127.0.0.1.example.test/private']) {
    it(`preserves the explicit URL block ${pattern}`, async () => {
      class ExplicitConfig extends GuardedConfig {
        public getBlockedURLPatterns(): string[] {
          return ['file://', pattern];
        }
      }
      const page = await newGuardedPage(
        resolveEverythingLocally(),
        new ExplicitConfig(),
      );
      const result = await page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const image = new Image();
            image.onload = () => resolve('loaded');
            image.onerror = () => resolve('blocked');
            image.src = 'http://127.0.0.1.example.test/private/logo.svg';
          }),
      );

      expect(result).to.equal('blocked');
      expect(hits).not.to.include('/private/logo.svg');
    });
  }

  it('keeps blocking when ordered rules are unsupported', async () => {
    class LegacyOnlyBrowser extends ChromiumCDP {
      protected async pageSession(page: Page) {
        const session = await super.pageSession(page);
        if (session) {
          // Simulate an older protocol, but let Chromium enforce every legacy
          // command. The assertion is on real destination traffic.
          sinon
            .stub(session, 'send')
            .callThrough()
            .withArgs('Network.setBlockedURLs', sinon.match.has('urlPatterns'))
            .rejects(new Error('Unsupported URL patterns'));
        }
        return session;
      }
    }
    browser = new LegacyOnlyBrowser({
      blockAds: false,
      config: new GuardedConfig(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    await browser.launch({ options: { args: [] }, stealth: false });
    const page = await browser.newPage();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const loaded = await page.evaluate(
      (url) =>
        new Promise<boolean>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = url;
        }),
      `http://127.0.0.1:${port}/legacy-blocked.svg`,
    );

    expect(loaded).to.be.false;
    expect(hits).not.to.include('/legacy-blocked.svg');
  });
});

describe('ChromiumCDP upgrade marking (#5591)', () => {
  it('marks a socket proxied after the backend upgrades, not before', async () => {
    const browser = new ChromiumCDP({
      blockAds: false,
      config: new Config(),
      logger: new Logger('browsers.cdp.spec'),
      userDataDir: null,
    });
    const shared = (browser as unknown as { proxy: EventEmitter }).proxy;
    const socket = new PassThrough();
    const proxyReq = new EventEmitter();

    shared.emit('proxyReqWs', proxyReq, {}, socket, {}, Buffer.alloc(0));
    expect(isSocketProxied(socket)).to.be.false;
    proxyReq.emit('upgrade', {}, new PassThrough(), Buffer.alloc(0));
    // Marking is deferred until after http-proxy has written the 101.
    expect(isSocketProxied(socket)).to.be.false;
    await new Promise((resolve) => setImmediate(resolve));
    expect(isSocketProxied(socket)).to.be.true;
  });
});
