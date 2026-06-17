import { expect } from 'chai';
import {
  Config,
  Logger,
  findBlockedUrlInMessage,
  normalizeUrlForBlocklist,
  wsFrameToString,
} from '@browserless.io/browserless';
import {
  ChromiumPlaywright,
  FirefoxPlaywright,
  WebKitPlaywright,
  browserlessChromiumDisabledFeatures,
  parseDisableFeatures,
  playwrightChromiumDisabledFeatures,
  withMergedChromiumDisableFeatures,
} from './browsers.playwright.js';
import net, { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, IncomingMessage, Server } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import playwrightCore from 'playwright-core';

/** Poll `cond` every 10ms up to `timeoutMs`; replaces brittle fixed sleeps. */
const waitFor = async (
  cond: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('BasePlaywright URL filter', () => {
  describe('wsFrameToString', () => {
    it('decodes a plain Buffer (default ws nodebuffer mode)', () => {
      const buf = Buffer.from('{"k":"v"}', 'utf-8');
      expect(wsFrameToString(buf)).to.equal('{"k":"v"}');
    });

    it('decodes a Buffer[] fragment list (defensive)', () => {
      const parts = [
        Buffer.from('{"a":"', 'utf-8'),
        Buffer.from('b"}', 'utf-8'),
      ];
      expect(wsFrameToString(parts)).to.equal('{"a":"b"}');
    });

    it('decodes an ArrayBuffer (ws arraybuffer mode)', () => {
      const src = Buffer.from('{"x":1}', 'utf-8');
      const ab = src.buffer.slice(
        src.byteOffset,
        src.byteOffset + src.byteLength,
      );
      expect(wsFrameToString(ab as ArrayBuffer)).to.equal('{"x":1}');
    });
  });

  describe('normalizeUrlForBlocklist', () => {
    it('lowercases the scheme', () => {
      expect(normalizeUrlForBlocklist('FILE:///etc/passwd')).to.match(
        /^file:\/\//,
      );
    });
    it('strips leading whitespace + control chars', () => {
      expect(normalizeUrlForBlocklist(' \tfile:///x')).to.match(/^file:\/\//);
      expect(normalizeUrlForBlocklist('\x01file:///x')).to.match(/^file:\/\//);
    });
    it('canonicalizes single-slash file:/etc/passwd', () => {
      expect(normalizeUrlForBlocklist('file:/etc/passwd')).to.match(
        /^file:\/\//,
      );
    });
    it('unwraps nested view-source: wrappers', () => {
      expect(
        normalizeUrlForBlocklist('view-source:view-source:file:///etc/passwd'),
      ).to.match(/^file:\/\//);
    });
    it('falls back to lowercased trim when URL parse fails', () => {
      expect(normalizeUrlForBlocklist(' NOT A URL ')).to.equal('not a url');
    });
  });

  describe('boundary: other URL wrappers are NOT unwrapped', () => {
    it('blob:file:// — match relies on the inner scheme not being unwrapped', () => {
      expect(
        findBlockedUrlInMessage({ url: 'blob:file:///etc/passwd' }, [
          'file://',
        ]),
      ).to.equal(null);
    });
    it('filesystem:file:// — same', () => {
      expect(
        findBlockedUrlInMessage({ url: 'filesystem:file:///etc/passwd' }, [
          'file://',
        ]),
      ).to.equal(null);
    });
    it('data: with file:// content is not unwrapped', () => {
      expect(
        findBlockedUrlInMessage({ url: 'data:text/plain,file:///etc/passwd' }, [
          'file://',
        ]),
      ).to.equal(null);
    });
  });

  describe('Config.getBlockedURLPatterns', () => {
    it('returns ["file://"] when ALLOW_FILE_PROTOCOL is false (default)', () => {
      const config = new Config();
      config.setAllowFileProtocol(false);
      expect(config.getBlockedURLPatterns()).to.deep.equal(['file://']);
    });

    it('returns [] when ALLOW_FILE_PROTOCOL is true', () => {
      const config = new Config();
      config.setAllowFileProtocol(true);
      expect(config.getBlockedURLPatterns()).to.deep.equal([]);
    });
  });

  describe('findBlockedUrlInMessage', () => {
    const patterns = ['file://', 'smtp://', 'ftp://'];

    it('returns null when patterns list is empty', () => {
      const msg = {
        method: 'Frame.goto',
        params: { url: 'file:///etc/passwd' },
      };
      expect(findBlockedUrlInMessage(msg, [])).to.equal(null);
    });

    it('returns null when message is null/primitive', () => {
      expect(findBlockedUrlInMessage(null, patterns)).to.equal(null);
      expect(findBlockedUrlInMessage(42, patterns)).to.equal(null);
      expect(findBlockedUrlInMessage('file://', patterns)).to.equal(null);
    });

    it('finds a top-level url field', () => {
      const msg = { url: 'file:///etc/passwd' };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal('file://');
    });

    it('finds a url inside nested params', () => {
      const msg = {
        method: 'Frame.goto',
        params: { url: 'file:///etc/passwd', waitUntil: 'load' },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal('file://');
    });

    it('finds a url inside doubly-nested params', () => {
      const msg = {
        method: 'BrowserContext.request',
        params: { request: { url: 'file:///proc/self/environ' } },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal('file://');
    });

    it('finds non-file blocked schemes', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'smtp://relay.example.com' } },
          patterns,
        ),
      ).to.equal('smtp://');
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'ftp://target/file' } },
          patterns,
        ),
      ).to.equal('ftp://');
    });

    it('is case-insensitive on the URL key name', () => {
      expect(
        findBlockedUrlInMessage({ URL: 'file:///etc/passwd' }, patterns),
      ).to.equal('file://');
      expect(
        findBlockedUrlInMessage({ Url: 'file:///etc/passwd' }, patterns),
      ).to.equal('file://');
    });

    it('ignores non-url keys whose value happens to contain "file://"', () => {
      const msg = {
        method: 'Runtime.evaluate',
        params: { expression: 'fetch("file:///etc/passwd")' },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal(null);
    });

    it('ignores url fields whose value does not start with a blocked pattern', () => {
      const msg = {
        method: 'Frame.goto',
        params: { url: 'https://example.com/file://' },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal(null);
    });

    it('ignores fields named urlFilter / urlPrefix (not navigation URLs)', () => {
      const msg = {
        method: 'recordHar',
        params: { urlFilter: 'file://', urlPrefix: 'file://' },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal(null);
    });

    it('returns null when no blocked URL is present', () => {
      const msg = {
        method: 'Frame.goto',
        params: { url: 'https://example.com', waitUntil: 'load' },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal(null);
    });

    it('handles arrays in the message tree', () => {
      const msg = {
        method: 'BrowserContext.routeContinue',
        params: {
          routes: [
            { url: 'https://example.com' },
            { url: 'file:///etc/passwd' },
          ],
        },
      };
      expect(findBlockedUrlInMessage(msg, patterns)).to.equal('file://');
    });

    // === Evasion battery — every entry below must block ===========================
    // These cover normalizations Chromium performs before navigation that a
    // naive `value.startsWith('file://')` check would miss.

    it('blocks uppercase scheme FILE://', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'FILE:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks mixed-case scheme File://', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'File:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks leading whitespace before scheme', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: '  file:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks leading tab + newline before scheme', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: '\t\nfile:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks single-slash file:/etc/passwd (Chromium canonicalizes to file:///)', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'file:/etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks view-source:file:///etc/passwd wrapper', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'view-source:file:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks nested view-source:view-source:file://', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'view-source:view-source:file:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks case-mixed view-source wrapper VIEW-SOURCE:File://', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'VIEW-SOURCE:File:///etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });

    it('blocks file://localhost/etc/passwd (Chromium drops "localhost" host)', () => {
      expect(
        findBlockedUrlInMessage(
          { params: { url: 'file://localhost/etc/passwd' } },
          patterns,
        ),
      ).to.equal('file://');
    });
  });

  /**
   * End-to-end bridge test: wires up a fake "upstream" WebSocket server
   * standing in for the Playwright launchServer endpoint, points a
   * ChromiumPlaywright instance at it, and proxies through the actual
   * `proxyWebSocket` code path. Verifies that a real Frame.goto JSON-RPC
   * frame carrying file:// is blocked end-to-end: never reaches the
   * upstream, client connection is closed with status 1008, and the
   * browser wrapper is torn down.
   */
  describe('proxyWebSocket bridge', () => {
    let fakeUpstreamServer: WebSocketServer;
    let fakeUpstreamPort: number;
    let upstreamMessages: string[];
    let bridgeServer: Server;
    let bridgePort: number;
    let playwright: ChromiumPlaywright;
    let upstreamCloseReasons: number[];

    beforeEach(async () => {
      upstreamMessages = [];
      upstreamCloseReasons = [];

      // 1. Fake upstream — collects what the bridge forwards.
      fakeUpstreamServer = new WebSocketServer({ port: 0 });
      await new Promise<void>((resolve) =>
        fakeUpstreamServer.on('listening', () => resolve()),
      );
      fakeUpstreamPort = (fakeUpstreamServer.address() as AddressInfo).port;
      fakeUpstreamServer.on('connection', (ws) => {
        ws.on('message', (data) => {
          upstreamMessages.push(data.toString());
          // Echo any non-blocking message back so the bridge has both
          // directions exercised in tests where we expect success.
          ws.send(
            JSON.stringify({ id: 1, result: { ack: upstreamMessages.length } }),
          );
        });
        ws.on('close', (code) => upstreamCloseReasons.push(code));
      });

      // 2. ChromiumPlaywright wired to point at the fake upstream.
      const config = new Config();
      config.setAllowFileProtocol(false);
      playwright = new ChromiumPlaywright({
        config,
        userDataDir: null,
        logger: new Logger('test'),
      });
      (
        playwright as unknown as { browserWSEndpoint: string }
      ).browserWSEndpoint = `ws://127.0.0.1:${fakeUpstreamPort}/`;
      (playwright as unknown as { running: boolean }).running = true;
      // Stub the launched browser so close() has something to tear down.
      (playwright as unknown as { browser: unknown }).browser = {
        close: async () => undefined,
      };

      // 3. HTTP server hosting the bridge — routes WS upgrades into
      // `proxyWebSocket`. `.catch()` swallows the rejection so error-path
      // tests don't trigger unhandled rejections.
      bridgeServer = createServer();
      bridgeServer.on('upgrade', (req: IncomingMessage, socket, head) => {
        (req as unknown as { parsed: URL }).parsed = new URL(
          `http://localhost${req.url ?? '/'}`,
        );
        playwright
          .proxyWebSocket(req as never, socket as never, head as never)
          .catch(() => {
            /* error-path tests assert via close events */
          });
      });
      await new Promise<void>((resolve) => {
        bridgeServer.listen(0, () => resolve());
      });
      bridgePort = (bridgeServer.address() as AddressInfo).port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) =>
        fakeUpstreamServer.close(() => resolve()),
      );
      await new Promise<void>((resolve) => bridgeServer.close(() => resolve()));
    });

    it('forwards a benign Frame.goto to the upstream', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      client.send(
        JSON.stringify({
          id: 1,
          method: 'goto',
          params: { url: 'https://example.com' },
        }),
      );
      await waitFor(() => upstreamMessages.length >= 1);
      expect(upstreamMessages).to.have.lengthOf(1);
      const parsed = JSON.parse(upstreamMessages[0]);
      expect(parsed.params.url).to.equal('https://example.com');
      client.close();
    });

    it('echoes the upstream ack back to the client (benign forward in both directions)', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const received: string[] = [];
      client.on('message', (data) => received.push(data.toString()));
      client.send(
        JSON.stringify({
          id: 9,
          method: 'goto',
          params: { url: 'https://example.com' },
        }),
      );
      await waitFor(() => received.length >= 1);
      const echoed = JSON.parse(received[0]);
      expect(echoed).to.have.nested.property('result.ack', 1);
      client.close();
    });

    it('blocks a Frame.goto carrying file:// and tears down the session', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const closeEvent = new Promise<{ code: number; reason: string }>(
        (resolve) =>
          client.on('close', (code, reason) =>
            resolve({ code, reason: reason.toString() }),
          ),
      );
      client.send(
        JSON.stringify({
          id: 2,
          method: 'goto',
          params: { url: 'file:///etc/passwd' },
        }),
      );
      const close = await closeEvent;
      expect(close.code).to.equal(1008);
      expect(close.reason).to.match(/Blocked URL pattern/);
      expect(upstreamMessages).to.have.lengthOf(0);
      await waitFor(() => playwright.wsEndpoint() === null);
    });

    it('blocks a Frame.goto to a private host when network ranges are configured', async () => {
      // A consumer opts in by overriding getBlockedNetworkRanges() — the same
      // mechanism a downstream SDK consumer uses to enable SSRF blocking.
      (
        playwright as unknown as { config: Config }
      ).config.getBlockedNetworkRanges = () => ({
        ipv4Prefixes: ['0.', '127.', '169.254.'],
        ipv6Prefixes: ['::1', '::', 'fc', 'fd', 'fe80:', '::ffff:'],
        protocols: [],
        hostnames: ['localhost'],
      });
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const closeEvent = new Promise<{ code: number; reason: string }>(
        (resolve) =>
          client.on('close', (code, reason) =>
            resolve({ code, reason: reason.toString() }),
          ),
      );
      client.send(
        JSON.stringify({
          id: 3,
          method: 'goto',
          params: { url: 'http://169.254.169.254/latest/meta-data' },
        }),
      );
      const close = await closeEvent;
      expect(close.code).to.equal(1008);
      expect(close.reason).to.match(/Blocked navigation/);
      expect(upstreamMessages).to.have.lengthOf(0);
      await waitFor(() => playwright.wsEndpoint() === null);
    });

    it('forwards a Frame.goto to a public host even with network ranges configured', async () => {
      (
        playwright as unknown as { config: Config }
      ).config.getBlockedNetworkRanges = () => ({
        ipv4Prefixes: ['127.', '169.254.'],
        ipv6Prefixes: ['::1'],
        protocols: [],
        hostnames: ['localhost'],
      });
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      client.send(
        JSON.stringify({
          id: 4,
          method: 'goto',
          params: { url: 'https://example.com/' },
        }),
      );
      await waitFor(() => upstreamMessages.length >= 1);
      expect(upstreamMessages).to.have.lengthOf(1);
      expect(JSON.parse(upstreamMessages[0]).params.url).to.equal(
        'https://example.com/',
      );
      client.close();
    });

    it('blocks a Frame.goto carrying file:// sent as a BINARY frame', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const closeEvent = new Promise<number>((resolve) =>
        client.on('close', (code) => resolve(code)),
      );
      // Same JSON-RPC command as a binary frame — upstream parses every
      // opcode, so skipping binary here would be a filter bypass.
      client.send(
        Buffer.from(
          JSON.stringify({
            id: 5,
            method: 'goto',
            params: { url: 'file:///etc/passwd' },
          }),
        ),
        { binary: true },
      );
      const code = await closeEvent;
      expect(code).to.equal(1008);
      expect(upstreamMessages).to.have.lengthOf(0);
      await waitFor(() => playwright.wsEndpoint() === null);
    });

    it('blocks a server→client request event carrying file:// (indirect navigation, e.g. via page.evaluate fetch)', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const closeEvent = new Promise<number>((resolve) =>
        client.on('close', (code) => resolve(code)),
      );
      // Simulate Chromium initiating a file:// fetch on its own (e.g.
      // JS-side fetch after a legitimate goto). Poll until the bridge's
      // upstream side is connected rather than guessing with a sleep.
      await waitFor(() => fakeUpstreamServer.clients.size > 0);
      for (const ws of fakeUpstreamServer.clients) {
        ws.send(
          JSON.stringify({
            guid: 'browser-context-1',
            method: 'request',
            params: { request: { url: 'file:///proc/self/environ' } },
          }),
        );
      }
      const code = await closeEvent;
      expect(code).to.equal(1008);
      await waitFor(() => playwright.wsEndpoint() === null);
    });

    it('blocks percent-encoded `file:%2f%2f…` via the synthesized file:// authority', () => {
      // `new URL('file:%2f%2fetc/passwd').href` → `file:///%2f%2fetc/passwd`
      // (`%2f` stays encoded); match hits the synthesized `file://` prefix.
      expect(
        findBlockedUrlInMessage({ url: 'file:%2f%2fetc/passwd' }, ['file://']),
      ).to.equal('file://');
    });

    it('blocks Unicode-escaped scheme (`\\u0066ile://...`) the upstream would decode', async () => {
      // Raw frame has no literal `file`; the upstream's `JSON.parse`
      // would decode `f` to `f`, so the bridge must too.
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const closeEvent = new Promise<number>((resolve) =>
        client.on('close', (code) => resolve(code)),
      );
      // Build the JSON string by hand — `JSON.stringify` would
      // collapse `f` back to a literal `f`.
      const rawJson =
        '{"id":1,"method":"goto","params":{"url":"\\u0066ile:///etc/passwd"}}';
      expect(rawJson).to.not.match(/file/);
      client.send(rawJson);
      const code = await closeEvent;
      expect(code).to.equal(1008);
      expect(upstreamMessages).to.have.lengthOf(0);
      await waitFor(() => playwright.wsEndpoint() === null);
    });

    it('fails closed on unparseable frame containing a blocked stem', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const closeEvent = new Promise<number>((resolve) =>
        client.on('close', (code) => resolve(code)),
      );
      // Not valid JSON; contains `file://` substring.
      client.send('not-json{ file:///etc/passwd');
      const code = await closeEvent;
      expect(code).to.equal(1008);
      expect(upstreamMessages).to.have.lengthOf(0);
    });

    it('forwards an unparseable BINARY frame even when it bears a blocked stem', async () => {
      // Mirror of the text-frame fail-closed: a benign binary blob
      // containing a `file` byte run (e.g. a profile filename in a
      // proprietary binary protocol) must still pass through, since
      // upstream parses with JSON.parse and won't act on it either.
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      const blob = Buffer.from(
        '\x00\x01file://something-that-is-not-json\xff\xfe',
        'binary',
      );
      client.send(blob, { binary: true });
      await waitFor(() => upstreamMessages.length >= 1);
      expect(upstreamMessages).to.have.lengthOf(1);
      client.close();
    });

    it('forwards unparseable frames that do not bear a blocked stem', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      client.send('plain-text-keepalive');
      await waitFor(() => upstreamMessages.length >= 1);
      expect(upstreamMessages[0]).to.equal('plain-text-keepalive');
      client.close();
    });

    it('aborted upgrade settles the Promise via the socket backstop', async () => {
      // Malformed upgrade (no `Sec-WebSocket-Key`) — `ws` aborts and
      // never invokes the upgrade callback. The Promise has to settle
      // via the socket-close backstop or the slot leaks.
      let resolved = false;
      const ranToCompletion = new Promise<void>((resolve) => {
        // Hook a fresh upgrade handler that exposes the Promise.
        const onUpgrade = (
          req: IncomingMessage,
          socket: import('stream').Duplex,
          head: Buffer,
        ) => {
          (req as unknown as { parsed: URL }).parsed = new URL(
            `http://localhost${req.url ?? '/'}`,
          );
          playwright
            .proxyWebSocket(req as never, socket as never, head as never)
            .catch(() => undefined)
            .finally(() => {
              resolved = true;
              resolve();
            });
        };
        bridgeServer.removeAllListeners('upgrade');
        bridgeServer.on('upgrade', onUpgrade);
      });

      // Raw TCP upgrade lacking Sec-WebSocket-Key — `ws` will reject.
      const raw = net.connect(bridgePort, '127.0.0.1');
      await new Promise<void>((r) => raw.on('connect', () => r()));
      raw.write(
        'GET / HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          '\r\n',
      );
      await Promise.race([
        ranToCompletion,
        new Promise<void>((_, rj) =>
          setTimeout(
            () =>
              rj(new Error('bridge promise did not settle on aborted upgrade')),
            2000,
          ),
        ),
      ]);
      expect(resolved).to.equal(true);
      raw.destroy();
    });

    it('blocks Frame.goto with file:// across Firefox and WebKit subclasses', async () => {
      for (const Subclass of [FirefoxPlaywright, WebKitPlaywright]) {
        const upstream = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => upstream.on('listening', () => r()));
        const upPort = (upstream.address() as AddressInfo).port;
        const seen: string[] = [];
        upstream.on('connection', (ws) => {
          ws.on('message', (data) => seen.push(data.toString()));
        });
        const cfg = new Config();
        cfg.setAllowFileProtocol(false);
        const subjectInstance = new Subclass({
          config: cfg,
          userDataDir: null,
          logger: new Logger('test'),
        });
        (
          subjectInstance as unknown as { browserWSEndpoint: string }
        ).browserWSEndpoint = `ws://127.0.0.1:${upPort}/`;
        (subjectInstance as unknown as { running: boolean }).running = true;
        (subjectInstance as unknown as { browser: unknown }).browser = {
          close: async () => undefined,
        };
        const subjectServer = createServer();
        subjectServer.on('upgrade', (r: IncomingMessage, sock, h) => {
          (r as unknown as { parsed: URL }).parsed = new URL(
            `http://localhost${r.url ?? '/'}`,
          );
          subjectInstance
            .proxyWebSocket(r as never, sock as never, h as never)
            .catch(() => {
              /* error paths assert via close events */
            });
        });
        await new Promise<void>((r) => subjectServer.listen(0, () => r()));
        const port = (subjectServer.address() as AddressInfo).port;

        try {
          const client = new WebSocket(`ws://127.0.0.1:${port}/`);
          await new Promise<void>((resolve, reject) => {
            client.on('open', () => resolve());
            client.on('error', reject);
          });
          const closeEvent = new Promise<{ code: number; reason: string }>(
            (resolve) =>
              client.on('close', (code, reason) =>
                resolve({ code, reason: reason.toString() }),
              ),
          );
          client.send(
            JSON.stringify({
              id: 1,
              method: 'goto',
              params: { url: 'file:///etc/passwd' },
            }),
          );
          const close = await closeEvent;
          expect(close.code, `${Subclass.name} close code`).to.equal(1008);
          expect(close.reason, `${Subclass.name} close reason`).to.match(
            /Blocked URL pattern/,
          );
          expect(close.reason, `${Subclass.name} class in reason`).to.match(
            new RegExp(Subclass.name),
          );
          expect(seen.length, `${Subclass.name} upstream untouched`).to.equal(
            0,
          );
        } finally {
          await new Promise<void>((r) => subjectServer.close(() => r()));
          await new Promise<void>((r) => upstream.close(() => r()));
        }
      }
    });

    it('does not block when ALLOW_FILE_PROTOCOL is true (empty patterns)', async () => {
      // Re-wire with file protocol allowed.
      (playwright as unknown as { config: Config }).config.setAllowFileProtocol(
        true,
      );
      const client = new WebSocket(`ws://127.0.0.1:${bridgePort}/`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve());
        client.on('error', reject);
      });
      client.send(
        JSON.stringify({
          id: 3,
          method: 'goto',
          params: { url: 'file:///etc/passwd' },
        }),
      );
      await waitFor(() => upstreamMessages.length >= 1);
      // File-protocol-allowed: message should pass through to upstream.
      expect(upstreamMessages).to.have.lengthOf(1);
      expect(playwright.wsEndpoint()).to.equal(
        `ws://127.0.0.1:${fakeUpstreamPort}/`,
      );
      client.close();
    });
  });
});

describe('BasePlaywright --disable-features merging (issue #5450)', () => {
  const disableFeaturesFlags = (args: string[]): string[] =>
    args.filter((a) => a.startsWith('--disable-features='));

  type Launchable = {
    makeLaunchOptions: (o: { args?: string[]; headless?: boolean }) => {
      args: string[];
    };
  };
  type PwCtor = new (o: {
    config: Config;
    logger: Logger;
    userDataDir: string | null;
  }) => unknown;
  // Build a launcher's args, dropping the empty strings launch() filters out
  // before handing them to launchServer.
  const launchArgs = (Ctor: PwCtor, args: string[]): string[] => {
    const instance = new Ctor({
      config: new Config(),
      logger: new Logger('test'),
      userDataDir: null,
    });
    return (instance as unknown as Launchable)
      .makeLaunchOptions({ args })
      .args.filter((a) => !!a);
  };

  describe('withMergedChromiumDisableFeatures', () => {
    it('collapses everything into exactly one --disable-features flag', () => {
      const out = withMergedChromiumDisableFeatures([
        '--disable-features=CallerOne',
        '--foo',
      ]);
      expect(disableFeaturesFlags(out)).to.have.lengthOf(1);
    });

    it('includes every Playwright default and every browserless addition', () => {
      const features = parseDisableFeatures(
        withMergedChromiumDisableFeatures([]),
      );
      for (const f of playwrightChromiumDisabledFeatures) {
        expect(features, `missing Playwright feature "${f}"`).to.include(f);
      }
      for (const f of browserlessChromiumDisabledFeatures) {
        expect(features, `missing browserless feature "${f}"`).to.include(f);
      }
    });

    it('keeps RenderDocument (Playwright) AND LocalNetworkAccessChecks (browserless) together', () => {
      // Core regression: the old standalone
      // `--disable-features=LocalNetworkAccessChecks` overrode Playwright's list
      // and re-enabled RenderDocument.
      const features = parseDisableFeatures(
        withMergedChromiumDisableFeatures([]),
      );
      expect(features).to.include('RenderDocument');
      expect(features).to.include('LocalNetworkAccessChecks');
    });

    it('merges caller-supplied --disable-features rather than dropping them', () => {
      const out = withMergedChromiumDisableFeatures([
        '--disable-features=CallerOne,CallerTwo',
        '--window-size=800,600',
      ]);
      expect(disableFeaturesFlags(out)).to.have.lengthOf(1);
      const features = parseDisableFeatures(out);
      expect(features).to.include('CallerOne');
      expect(features).to.include('CallerTwo');
      expect(features).to.include('RenderDocument');
      expect(features).to.include('LocalNetworkAccessChecks');
      // Unrelated args are preserved untouched.
      expect(out).to.include('--window-size=800,600');
    });

    it('never emits duplicate features', () => {
      const features = parseDisableFeatures(
        withMergedChromiumDisableFeatures([
          '--disable-features=RenderDocument,LocalNetworkAccessChecks,Translate',
        ]),
      );
      expect(features.length).to.equal(new Set(features).size);
    });
  });

  describe('makeLaunchOptions', () => {
    it('Chromium emits a single merged --disable-features with both lists', () => {
      const args = launchArgs(ChromiumPlaywright, []);
      expect(disableFeaturesFlags(args)).to.have.lengthOf(1);
      const features = parseDisableFeatures(args);
      expect(features).to.include('RenderDocument');
      expect(features).to.include('LocalNetworkAccessChecks');
    });

    it('does not add chromium --disable-features to Firefox or WebKit', () => {
      for (const Ctor of [FirefoxPlaywright, WebKitPlaywright]) {
        const args = launchArgs(Ctor as unknown as PwCtor, []);
        expect(
          disableFeaturesFlags(args),
          `${Ctor.name} should not receive --disable-features`,
        ).to.have.lengthOf(0);
      }
    });
  });

  describe('interaction with the installed Playwright version', () => {
    // Ground truth for the installed version: capture the exact args Playwright
    // passes to the browser by pointing launchServer at a fake executable that
    // records its argv and exits. No internal/private imports — this reflects
    // whatever the pinned Playwright actually emits.
    const captureLaunchArgv = async (args: string[]): Promise<string[]> => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bless-pw-argv-'));
      const argvFile = path.join(dir, 'argv.json');
      const fakeBin = path.join(dir, 'fake-browser.cjs');
      fs.writeFileSync(
        fakeBin,
        `#!${process.execPath}\n` +
          `require('fs').writeFileSync(${JSON.stringify(
            argvFile,
          )}, JSON.stringify(process.argv.slice(2)));\n` +
          `process.exit(1);\n`,
      );
      fs.chmodSync(fakeBin, 0o755);
      try {
        const server = await playwrightCore.chromium.launchServer({
          args,
          executablePath: fakeBin,
          timeout: 15000,
        });
        await server.close().catch(() => undefined);
      } catch {
        // Expected: the fake browser exits before printing a WS endpoint.
      }
      if (!fs.existsSync(argvFile)) {
        throw new Error(
          'Playwright never invoked the fake browser — capture method needs revisiting',
        );
      }
      const argv: string[] = JSON.parse(fs.readFileSync(argvFile, 'utf-8'));
      fs.rmSync(dir, { recursive: true, force: true });
      return argv;
    };

    const assertNoDrift = async (): Promise<void> => {
      const live = parseDisableFeatures(await captureLaunchArgv([]));
      expect(live, 'captured an empty Playwright --disable-features list').to
        .not.be.empty;

      const mirror = new Set(playwrightChromiumDisabledFeatures);
      const liveSet = new Set(live);
      const addedByPlaywright = [...liveSet].filter((f) => !mirror.has(f));
      const removedByPlaywright = [...mirror].filter((f) => !liveSet.has(f));

      expect(
        addedByPlaywright,
        'Playwright ADDED disabled-feature(s) not in playwrightChromiumDisabledFeatures — add them',
      ).to.deep.equal([]);
      expect(
        removedByPlaywright,
        'Playwright REMOVED disabled-feature(s) still in playwrightChromiumDisabledFeatures — remove them',
      ).to.deep.equal([]);
    };

    const assertBrowserlessFlagWins = async (): Promise<void> => {
      // Feed the args browserless actually passes to the real Playwright
      // launcher. Playwright prepends its own --disable-features and appends
      // ours after it; Chromium keeps the LAST occurrence, so the winning flag
      // must be browserless's superset carrying BOTH lists.
      const argv = await captureLaunchArgv(launchArgs(ChromiumPlaywright, []));
      const disableFlags = disableFeaturesFlags(argv);
      expect(
        disableFlags.length,
        'expected Playwright + browserless --disable-features flags',
      ).to.be.greaterThan(0);
      const winning = parseDisableFeatures([
        disableFlags[disableFlags.length - 1],
      ]);
      expect(winning).to.include('RenderDocument'); // Playwright's, preserved
      expect(winning).to.include('LocalNetworkAccessChecks'); // browserless's
    };

    // Fake executable relies on a POSIX shebang; browserless runs on Linux.
    const itPosix = process.platform === 'win32' ? it.skip : it;
    itPosix(
      'mirror equals Playwright exactly — fails on any feature added or removed',
      async () => {
        await assertNoDrift();
      },
    ).timeout(60000);
    itPosix(
      "browserless's merged --disable-features is the one Chromium keeps",
      async () => {
        await assertBrowserlessFlagWins();
      },
    ).timeout(60000);
  });
});
