/* eslint-disable no-unused-expressions */
import * as http from 'http';
import * as net from 'net';
import {
  APITags,
  BeforeRequest,
  BrowserHTTPRoute,
  Browserless,
  BrowserManager,
  Config,
  HTTPRoute,
  HTTPServer,
  Hooks,
  LifecycleConflict,
  Limiter,
  Logger,
  Methods,
  Metrics,
  Monitoring,
  Request,
  Response,
  Route,
  Router,
  Token,
  WebHooks,
  WebSocketRoute,
  WorkerLifecycle,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import Sinon from 'sinon';
import { expect } from 'chai';
import { EventEmitter } from 'events';
import stream from 'stream';

// Real HTTP listener, real HTTPServer/Router/Limiter/WorkerLifecycle and a
// real Browserless composition; no browser processes (routes are non-browser).

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, reject, resolve };
};
const until = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const expectNow = (lc: WorkerLifecycle) => ({
  bootId: lc.bootId,
  generation: lc.generation,
});

class TestRoute extends HTTPRoute {
  public accepts = [contentTypes.any];
  public auth = true;
  public contentTypes = [contentTypes.text];
  public description = 'test';
  public method = Methods.get;
  public tags: APITags[] = [];
  constructor(
    public name: string,
    public path: string,
    public override handler: (req: Request, res: Response) => Promise<unknown>,
    concurrency = false,
  ) {
    super(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    this.concurrency = concurrency;
  }
}

class TestHooks extends Hooks {
  public beforeGate: Promise<void> | null = null;
  async before({ req }: BeforeRequest): Promise<boolean> {
    if (req.url?.startsWith('/slow-before') && this.beforeGate) {
      await this.beforeGate;
    }
    return true;
  }
  async after(): Promise<unknown> {
    return undefined;
  }
}

class HealthRouter extends Router {
  protected isAdmittedWhenClosed(route: Route): boolean {
    return ['health', 'control', 'health-ws'].includes(route.name);
  }
}

class TestWSRoute extends WebSocketRoute {
  public auth = true;
  public description = 'test';
  public tags: APITags[] = [];
  constructor(
    public name: string,
    public path: string,
    public override handler: (
      req: Request,
      socket: stream.Duplex,
    ) => Promise<unknown>,
  ) {
    super(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    this.concurrency = false;
  }
}

let port = 4300;
const ok = (res: Response) => writeResponse(res, 200, 'ok');

const build = async () => {
  const lc = new WorkerLifecycle();
  const config = new Config();
  config.setToken('t');
  config.setPort(++port);
  config.setConcurrent(5);
  config.setQueued(5);
  config.setTimeout(0);
  const metrics = new Metrics();
  const monitoring = new Monitoring(config);
  const webhooks = new WebHooks(config);
  const hooks = new TestHooks();
  const token = new Token(config);
  const limiter = new Limiter(config, metrics, monitoring, webhooks, hooks);
  const browserManager = new BrowserManager(config, hooks, null as never);
  const router = new HealthRouter(
    config,
    browserManager,
    limiter,
    Logger,
    hooks,
  );
  const browserless = new Browserless({
    browserManager,
    config,
    hooks,
    lifecycle: lc,
    limiter,
    metrics,
    monitoring,
    router,
    token,
    webhooks,
  });
  const slow = deferred();
  const gates = {
    health: null as Promise<void> | null,
    slow,
    ws: deferred(),
  };
  router.registerHTTPRoute(
    new TestRoute('work', '/work', async (_q, r) => ok(r)),
  );
  router.registerHTTPRoute(
    new TestRoute('slow-before', '/slow-before', async (_q, r) => ok(r)),
  );
  router.registerHTTPRoute(
    new TestRoute('slow', '/slow', async (_q, r) => {
      await gates.slow.promise;
      ok(r);
    }),
  );
  router.registerHTTPRoute(
    new TestRoute('limited', '/limited', async (_q, r) => ok(r), true),
  );
  router.registerHTTPRoute(
    new TestRoute('health', '/health', async (_q, r) => {
      if (gates.health) await gates.health;
      ok(r);
    }),
  );
  router.registerHTTPRoute(
    new TestRoute('control', '/control', async (req, res) => {
      // In-band control acknowledges initiation; final completion is out-of-band.
      const report = await browserless.shutdownGracefully(
        { bootId: lc.bootId, generation: lc.generation },
        { caller: req },
      );
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
    }),
  );
  router.registerWebSocketRoute(
    new TestWSRoute('health-ws', '/health-ws', async (_req, socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      );
      await gates.ws.promise;
      socket.end();
    }),
  );
  const server = new HTTPServer(config, metrics, token, router, hooks, Logger);
  server.setLifecycle(lc);
  await server.start();
  browserless.server = server;
  const get = (p: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get(`http://localhost:${config.getPort()}${p}`, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ body, status: res.statusCode ?? 0 }));
        })
        .on('error', reject);
    });
  return {
    browserless,
    config,
    gates,
    get,
    hooks,
    lc,
    monitoring,
    router,
    server,
    webhooks,
  };
};

const instrument = (browserless: Browserless) => {
  const ran: string[] = [];
  const target = browserless as unknown as {
    gracefulShutdownSteps(): Array<{ name: string; run(): Promise<unknown> }>;
  };
  const steps = target.gracefulShutdownSteps.bind(browserless);
  target.gracefulShutdownSteps = () =>
    steps().map((step) => ({
      ...step,
      run: async () => {
        ran.push(step.name);
        return step.run();
      },
    }));
  return ran;
};

const SDK_STEP_ORDER = [
  'stop-metrics-interval',
  'close-listener',
  'idle-barrier',
  'server',
  'router',
  'limiter',
  'browser-manager',
  'hooks',
  'webhooks',
  'token',
  'monitoring',
  'metrics',
  'file-system',
  'config',
];

const closeWorker = async (lc: WorkerLifecycle) => {
  lc.withdraw(expectNow(lc));
  const snap = await lc.tryCloseAdmission(expectNow(lc));
  expect(snap.state, snap.reasons.join('; ')).to.equal('admissionClosed');
  return snap;
};

describe('Terminal admission closure and ordered stop (real listener, no browsers)', () => {
  const stacks: Array<Awaited<ReturnType<typeof build>>> = [];
  const stack = async () => {
    const s = await build();
    stacks.push(s);
    return s;
  };
  afterEach(async () => {
    for (const s of stacks.splice(0)) {
      s.gates.ws.resolve();
      s.monitoring.stop();
      await s.browserless.stop().catch(() => undefined);
    }
  });

  describe('admission closure', () => {
    it('a request stalled in hooks.before stays counted but cannot hold closure; it is then refused, not admitted', async () => {
      const { get, hooks, lc } = await stack();
      const before = deferred();
      hooks.beforeGate = before.promise;
      const pending = get('/slow-before?token=t');
      await until(() => !!lc.snapshot().tracked['server-request'], 'arrival');

      const snap = await closeWorker(lc);
      expect(snap.drainComplete).to.be.true; // arrival still counts at the idle barrier
      expect(snap.tracked).to.deep.equal({ 'server-request': 1 });

      before.resolve();
      const res = await pending;
      expect(res.status).to.equal(503);
      expect(res.body).to.include('worker_closed');
      await lc.whenIdle();
      expect(lc.snapshot().drainComplete).to.be.true;
      expect(lc.snapshot().failures).to.deep.equal([]);
    });

    it('after closure: unauthenticated 401, application 503, admitted status 200 with its after-hook as a legitimate descendant', async () => {
      const { get, lc } = await stack();
      await closeWorker(lc);
      expect((await get('/work')).status).to.equal(401);
      expect((await get('/health')).status).to.equal(401);
      const late = await get('/work?token=t');
      expect(late.status).to.equal(503);
      expect(late.body).to.include('worker_closed');
      expect((await get('/health?token=t')).status).to.equal(200);
      await lc.whenIdle();
      const snap = lc.snapshot();
      expect(snap.failures).to.deep.equal([]);
      expect(snap.drainComplete).to.be.true;
    });

    it('continuous status polling and arrivals still in hooks.before cannot starve closure', async () => {
      const { gates, get, hooks, lc } = await stack();
      const health = deferred();
      gates.health = health.promise;
      const before = deferred();
      hooks.beforeGate = before.promise;
      const polls = [get('/health?token=t'), get('/health?token=t')];
      const arriving = get('/slow-before?token=t');
      await until(
        () =>
          (lc.snapshot().tracked['route-handler'] ?? 0) >= 2 &&
          (lc.snapshot().tracked['server-request'] ?? 0) >= 3,
        'polls and arrival in flight',
      );
      const snap = await closeWorker(lc);
      expect(snap.drainComplete).to.be.true;
      health.resolve();
      expect((await Promise.all(polls)).map((r) => r.status)).to.deep.equal([
        200, 200,
      ]);
      before.resolve();
      expect((await arriving).status).to.equal(503);
      await lc.whenIdle();
      expect(lc.snapshot().drainComplete).to.be.true;
      expect(lc.snapshot().failures).to.deep.equal([]);
    });

    it('a request awaiting limiter admission (async health check) holds closure', async () => {
      const { config, get, lc, monitoring } = await stack();
      config.enableHealthChecks(true);
      const health = deferred<{
        cpuOverloaded: boolean;
        memoryOverloaded: boolean;
      }>();
      monitoring.overloaded = () => health.promise as never;
      const pending = get('/limited?token=t');
      await until(() => !!lc.snapshot().tracked['route-request'], 'admission');
      lc.withdraw(expectNow(lc));
      const snap = await lc.tryCloseAdmission(expectNow(lc));
      expect(snap.state).to.equal('withdrawn');
      expect(snap.reasons).to.include('1 outstanding work "route-request"');
      health.resolve({ cpuOverloaded: false, memoryOverloaded: false });
      expect((await pending).status).to.equal(200);
      await lc.whenIdle();
      expect((await lc.tryCloseAdmission(expectNow(lc))).drainComplete).to.be
        .true;
    });

    it('a real client abort leaves the original handler counted and holding closure until it settles', async () => {
      const { config, gates, lc } = await stack();
      const req = http.get(`http://localhost:${config.getPort()}/slow?token=t`);
      req.on('error', () => undefined);
      await until(() => !!lc.snapshot().tracked['route-handler'], 'handler');
      const aborted = new Promise((r) => req.once('close', r));
      req.destroy();
      await aborted;
      lc.withdraw(expectNow(lc));
      const snap = await lc.tryCloseAdmission(expectNow(lc));
      expect(snap.state).to.equal('withdrawn');
      expect(snap.reasons).to.include('1 outstanding work "route-handler"');
      gates.slow.resolve();
      await lc.whenIdle();
      expect((await lc.tryCloseAdmission(expectNow(lc))).drainComplete).to.be
        .true;
    });

    it('cleanup that synchronously spawns follow-up work keeps closure blocked', async () => {
      const lc = new WorkerLifecycle();
      const first = deferred();
      lc.track(
        'cleanup-a',
        first.promise.then(() => {
          lc.track('cleanup-b', new Promise(() => undefined));
        }),
      );
      lc.withdraw(expectNow(lc));
      first.resolve();
      await new Promise((r) => setImmediate(r));
      const snap = await lc.tryCloseAdmission(expectNow(lc));
      expect(snap.state).to.equal('withdrawn');
      expect(snap.tracked).to.deep.equal({ 'cleanup-b': 1 });
    });

    it('after closure, only descendants of admitted owners may start work; anything else is a failure', async () => {
      const lc = new WorkerLifecycle();
      const status = {};
      const unadmitted = {};
      lc.admitAfterClose(status);
      await closeWorker(lc);
      await lc.track('after-hook', Promise.resolve(), { owner: status });
      expect(lc.snapshot().failures).to.deep.equal([]);
      await lc.track('after-hook', Promise.resolve(), { owner: unadmitted });
      await lc.track('timer-cleanup', Promise.resolve());
      expect(lc.snapshot().failures.map((f) => f.kind)).to.deep.equal([
        'after-hook',
        'timer-cleanup',
      ]);
      expect(lc.snapshot().drainComplete).to.be.false;
    });
  });

  describe('ordered terminal stop', () => {
    it('allows forced stop after missing, failed, or replaced server cleanup', async () => {
      const { browserless, server } = await stack();
      browserless.server = undefined;
      await browserless.stop();
      browserless.server = server;
      const shutdown = server.shutdown.bind(server);
      let attempts = 0;
      const error = new Error('transient server cleanup failure');
      server.shutdown = async () => {
        if (++attempts === 1) throw error;
        await shutdown();
      };
      expect(await browserless.stop().catch((e) => e)).to.equal(error);
      await browserless.stop();
      expect(attempts).to.equal(2);
      let replacementStopped = false;
      browserless.server = {
        shutdown: async () => {
          replacementStopped = true;
        },
      } as unknown as HTTPServer;
      await browserless.stop();
      expect(replacementStopped).to.be.true;
    });

    it('awaits server override cleanup exactly once across graceful and forced stop', async () => {
      for (const forced of [false, true]) {
        const { browserless, get, hooks, lc, server } = await stack();
        const after = deferred();
        hooks.after = () => after.promise;
        let cleanups = 0;
        const shutdown = server.shutdown.bind(server);
        server.shutdown = async () => {
          cleanups++;
          await shutdown();
        };
        await closeWorker(lc);
        await get('/control?token=t');
        if (forced) await browserless.stop();
        after.resolve();
        const report = await browserless.shutdownGracefully(expectNow(lc));
        expect(report.shutdownComplete).to.be.true;
        expect(cleanups).to.equal(1);
        await browserless.stop();
        await server.shutdown(); // The underlying server may already be cleared.
        await server.stopAccepting();
      }
    });

    it('refuses before closure and on a stale boot/generation, without running steps', async () => {
      const { browserless, get, lc } = await stack();
      const ran = instrument(browserless);
      lc.withdraw(expectNow(lc));
      expect(
        await browserless.shutdownGracefully(expectNow(lc)).catch((e) => e),
      ).to.be.instanceOf(LifecycleConflict);
      expect(
        await browserless
          .shutdownGracefully({ bootId: lc.bootId, generation: 0 })
          .catch((e) => e),
      ).to.be.instanceOf(LifecycleConflict);
      expect(ran).to.deep.equal([]);
      expect((await get('/work?token=t')).status).to.equal(200);
    });

    it('runs finalization despite historical failures but never reports clean shutdown', async () => {
      const { browserless, config, lc } = await stack();
      let shutdowns = 0;
      config.shutdown = async () => {
        shutdowns++;
      };
      lc.recordFailure('usage-save', new Error('transient failure'));
      await closeWorker(lc);
      const report = await browserless.shutdownGracefully(expectNow(lc));
      expect(report.shutdownComplete).to.be.false;
      expect(report.steps.map((step) => step.status)).to.deep.equal(
        SDK_STEP_ORDER.map(() => 'done'),
      );
      expect(report.reasons).to.include(
        'failed "usage-save": transient failure',
      );
      expect(report.drainComplete).to.be.false;
      await browserless.stop();
      expect(shutdowns).to.equal(1);
    });

    it('runs the named steps in order; the idle barrier waits for an admitted request; then stopped and idempotent', async () => {
      const { browserless, config, gates, get, lc } = await stack();
      let configShutdowns = 0;
      const shutdownConfig = config.shutdown.bind(config);
      config.shutdown = async () => {
        configShutdowns++;
        await shutdownConfig();
      };
      const ran = instrument(browserless);
      await closeWorker(lc);
      const health = deferred();
      gates.health = health.promise;
      const probe = get('/health?token=t');
      await until(() => !!lc.snapshot().tracked['route-handler'], 'probe');

      const terminating = browserless.shutdownGracefully(expectNow(lc));
      await new Promise((r) => setTimeout(r, 50));
      expect(ran).to.deep.equal(SDK_STEP_ORDER.slice(0, 3));

      health.resolve();
      const probed = await probe;
      expect(probed.status).to.equal(200);
      const report = await terminating;
      expect(report.shutdownComplete, report.reasons.join('; ')).to.be.true;
      expect(report.state).to.equal('stopped');
      expect(ran).to.deep.equal(SDK_STEP_ORDER);
      expect(report.steps.map((s) => [s.name, s.status])).to.deep.equal(
        SDK_STEP_ORDER.map((n) => [n, 'done']),
      );
      expect((await get('/health?token=t').catch((e) => e)).code).to.equal(
        'ECONNREFUSED',
      );
      expect(await browserless.shutdownGracefully(expectNow(lc))).to.equal(
        report,
      );
      expect(
        await browserless
          .shutdownGracefully({ ...expectNow(lc), generation: 0 })
          .catch((e) => e),
      ).to.be.instanceOf(LifecycleConflict);
      await browserless.stop();
      expect(configShutdowns).to.equal(1);
    });

    it('in-band shutdown waits for its after-hook before stopping dependencies', async () => {
      for (const fails of [false, true]) {
        const { browserless, get, hooks, lc } = await stack();
        const after = deferred();
        let entered = false;
        let stopped = false;
        hooks.stop = () => {
          stopped = true;
        };
        hooks.after = async () => {
          entered = true;
          if (stopped) throw new Error('after used stopped client');
          await after.promise;
          if (fails) throw new Error('after failed');
        };
        await closeWorker(lc);
        try {
          const res = await get('/control?token=t');
          expect(res.status).to.equal(202);
          expect(JSON.parse(res.body).shutdownComplete).to.be.false;
          expect(entered).to.be.true;
          expect(stopped).to.be.false;
        } finally {
          after.resolve();
        }
        const report = await browserless.shutdownGracefully(expectNow(lc));
        expect(report.shutdownComplete).to.equal(!fails);
        expect(stopped).to.be.true;
        expect(report.failures.map((f) => f.message)).to.deep.equal(
          fails ? ['after failed'] : [],
        );
        expect(await browserless.shutdownGracefully(expectNow(lc))).to.equal(
          report,
        );
      }
    });

    for (const forced of [false, true]) {
      it(
        forced
          ? 'forced stop interrupts a backpressured graceful shutdown'
          : 'waits for a backpressured response to flush before completing shutdown',
        async () => {
          const { browserless, config, lc, router } = await stack();
          const size = 32 * 1024 * 1024;
          let response!: Response;
          router.registerHTTPRoute(
            new TestRoute('buffered', '/buffered', async (_req, res) => {
              response = res;
              res.end(Buffer.alloc(size));
            }),
          );
          const incoming = await new Promise<http.IncomingMessage>(
            (resolve, reject) => {
              http
                .get(
                  `http://localhost:${config.getPort()}/buffered?token=t`,
                  (res) => {
                    res.pause();
                    resolve(res);
                  },
                )
                .on('error', reject);
            },
          );
          try {
            expect(response.writableFinished).to.be.false;
            await closeWorker(lc);
            let completed = false;
            const stopping = browserless
              .shutdownGracefully(expectNow(lc))
              .then((report) => {
                completed = true;
                return report;
              });
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(
              completed,
              JSON.stringify({
                finished: response.writableFinished,
                destroyed: response.destroyed,
                report: completed ? await stopping : null,
              }),
            ).to.be.false;
            if (forced) {
              await browserless.server?.stopAccepting();
              let stopped = false;
              const forcedStop = browserless.stop().then(() => {
                stopped = true;
              });
              await until(
                () => stopped,
                'forced stop without client disconnect',
              );
              await forcedStop;
              expect(response.destroyed).to.be.true;
              expect(response.writableFinished).to.be.false;
              await stopping;
              return;
            }
            let bytes = 0;
            const ended = new Promise<void>((resolve, reject) => {
              incoming.on('data', (chunk) => {
                bytes += chunk.length;
              });
              incoming.on('end', resolve);
              incoming.on('error', reject);
            });
            incoming.resume();
            await ended;
            expect(bytes).to.equal(size);
            expect((await stopping).shutdownComplete).to.be.true;
            expect(response.writableFinished).to.be.true;
          } finally {
            incoming.destroy();
          }
        },
      );
    }

    it('keep-alive: idle sockets close at close-listener, an in-flight one finishes with Connection: close, new connections are refused', async () => {
      const { browserless, config, gates, lc } = await stack();
      await closeWorker(lc);
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const busyAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const keepAliveGet = (a: http.Agent, p: string) =>
        new Promise<{ connection?: string; status: number }>((res, rej) =>
          http
            .get({ agent: a, path: p, port: config.getPort() }, (r) => {
              r.resume();
              r.on('end', () =>
                res({
                  connection: r.headers.connection,
                  status: r.statusCode ?? 0,
                }),
              );
            })
            .on('error', rej),
        );
      expect((await keepAliveGet(agent, '/health?token=t')).status).to.equal(
        200,
      );
      const idleSocket = Object.values(agent.freeSockets).flat()[0]!;
      const idleClosed = new Promise((r) => idleSocket.once('close', r));
      const health = deferred();
      gates.health = health.promise;
      const busy = keepAliveGet(busyAgent, '/health?token=t');
      await until(() => !!lc.snapshot().tracked['route-handler'], 'busy');

      const terminating = browserless.shutdownGracefully(expectNow(lc));
      await idleClosed;
      expect(
        (await keepAliveGet(agent, '/health?token=t').catch((e) => e)).code,
      ).to.equal('ECONNREFUSED');
      health.resolve();
      const done = await busy;
      expect(done).to.deep.equal({ connection: 'close', status: 200 });
      expect((await terminating).shutdownComplete).to.be.true;
      agent.destroy();
      busyAgent.destroy();
    });

    it('an upgraded socket admitted after closure is awaited by the idle barrier, not cut off', async () => {
      const { browserless, config, gates, lc } = await stack();
      const ran = instrument(browserless);
      await closeWorker(lc);
      const socket = net.connect(config.getPort(), 'localhost');
      let received = '';
      socket.on('data', (c) => (received += c));
      socket.write(
        'GET /health-ws?token=t HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
      await until(() => received.includes('101'), 'upgrade');
      const terminating = browserless.shutdownGracefully(expectNow(lc));
      await new Promise((r) => setTimeout(r, 50));
      expect(ran).to.deep.equal(SDK_STEP_ORDER.slice(0, 3));
      expect(socket.destroyed).to.be.false;
      gates.ws.resolve();
      const report = await terminating;
      expect(report.shutdownComplete, report.reasons.join('; ')).to.be.true;
      socket.destroy();
    });

    it('a failing step is recorded, later dependency steps are skipped, and the result never becomes complete', async () => {
      const { browserless, config, lc, webhooks } = await stack();
      await closeWorker(lc);
      webhooks.shutdown = () =>
        Promise.reject(new Error('webhook flush failed'));
      let configStopped = false;
      config.shutdown = async () => {
        configStopped = true;
      };

      const report = await browserless.shutdownGracefully(expectNow(lc));
      expect(report.shutdownComplete).to.be.false;
      expect(report.state).to.equal('admissionClosed');
      expect(report.steps.map((s) => [s.name, s.status])).to.deep.equal(
        SDK_STEP_ORDER.map((n) => {
          const i = SDK_STEP_ORDER.indexOf(n);
          const failedAt = SDK_STEP_ORDER.indexOf('webhooks');
          return [
            n,
            i < failedAt ? 'done' : i === failedAt ? 'failed' : 'skipped',
          ];
        }),
      );
      expect(report.steps.find((s) => s.name === 'webhooks')?.error).to.equal(
        'webhook flush failed',
      );
      expect(configStopped).to.be.false;
      expect(report.reasons).to.include(
        'failed "shutdown:webhooks": webhook flush failed',
      );
      expect(await browserless.shutdownGracefully(expectNow(lc))).to.equal(
        report,
      );
      expect(lc.markShutdownComplete()).to.be.false;
    });
  });
});

// Mock browser (no process): a retained session with a long keepUntil.
class RetainedBrowser extends EventEmitter {
  static keepFor = 0;
  public closed = 0;
  async launch() {}
  wsEndpoint() {
    return 'ws://127.0.0.1:1/devtools/browser/retained';
  }
  async close() {
    this.closed++;
  }
  isRunning() {
    return true;
  }
  keepUntil() {
    return RetainedBrowser.keepFor;
  }
}

describe('Retained browsers (mock browser, fake clock)', () => {
  let clock: Sinon.SinonFakeTimers;
  afterEach(() => clock?.restore());

  it('no deadline: a retained session blocks admission closure and graceful shutdown until it actually expires', async () => {
    clock = Sinon.useFakeTimers({ now: 0, toFake: ['Date', 'setTimeout'] });
    const lc = new WorkerLifecycle();
    const config = new Config();
    const manager = new BrowserManager(config, new Hooks(), null as never);
    manager.setLifecycle(lc);
    const browserless = new Browserless({
      browserManager: manager,
      config,
      lifecycle: lc,
    });
    const url = new URL('http://127.0.0.1/chromium');
    url.searchParams.set(
      'launch',
      JSON.stringify({ args: ['--user-data-dir=/nonexistent-test-dir'] }),
    );
    const req = { headers: {}, parsed: url, queryParams: {} } as never;
    const route = {
      browser: RetainedBrowser,
      defaultLaunchOptions: {},
      path: '/chromium',
    } as unknown as BrowserHTTPRoute;
    const browser = (await manager.getBrowserForRequest(
      req,
      route,
      new Logger('test'),
    )) as unknown as RetainedBrowser;
    const sixHours = 6 * 60 * 60 * 1000;
    RetainedBrowser.keepFor = Date.now() + sixHours;
    await manager.complete(browser as never);

    lc.withdraw(expectNow(lc));
    for (const elapsed of [0, sixHours / 2, sixHours - 1]) {
      clock.tick(elapsed === 0 ? 0 : elapsed - (Date.now() - 0));
      const snap = await lc.tryCloseAdmission(expectNow(lc));
      expect(snap.state).to.equal('withdrawn');
      expect(snap.sources['sdk-browsers']).to.equal(1);
      expect(
        await browserless.shutdownGracefully(expectNow(lc)).catch((e) => e),
      ).to.be.instanceOf(LifecycleConflict);
      expect(browser.closed).to.equal(0);
    }
    clock.tick(1); // the session's own keepUntil timer fires
    clock.restore();
    await until(() => !Object.keys(lc.snapshot().tracked).length, 'close');
    expect(browser.closed).to.equal(1);
    const snap = await lc.tryCloseAdmission(expectNow(lc));
    expect(snap.drainComplete, snap.reasons.join('; ')).to.be.true;
    (browserless as unknown as { monitoring: Monitoring }).monitoring.stop();
  });
});
