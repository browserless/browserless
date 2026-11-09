/* eslint-disable no-unused-expressions */
import {
  APITags,
  BLESS_PAGE_IDENTIFIER,
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  Config,
  HTTPServer,
  Hooks,
  LifecycleConflict,
  Limiter,
  Logger,
  Methods,
  Metrics,
  Monitoring,
  NotFound,
  Request,
  Router,
  Token,
  TooManyRequests,
  WebHooks,
  WorkerLifecycle,
  WorkerWithdrawn,
  contentTypes,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import Sinon from 'sinon';
import { expect } from 'chai';

// All browsers in this file are mocks (FakeBrowser): launch/close are
// barrier-controlled promises, no Chromium process is started. The SDK
// BrowserManager, Router, Limiter and WorkerLifecycle are the real classes.

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, reject, resolve };
};
const flush = () => new Promise<void>((r) => setImmediate(r));
// Waits for async cleanup (e.g. scratch-dir removal) to drain tracked work.
const drained = async (lc: WorkerLifecycle, kind?: string) => {
  const busy = () => {
    const { tracked } = lc.snapshot();
    return kind ? !!tracked[kind] : Object.keys(tracked).length > 0;
  };
  for (let i = 0; i < 200 && busy(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
};
const run = (r: { handler: unknown }, req: Request, res: unknown) =>
  (r.handler as (req: Request, res: unknown) => Promise<unknown>)(req, res);

const expectFor = (lc: WorkerLifecycle) => ({
  bootId: lc.bootId,
  generation: lc.generation,
});

let browserSeq = 0;
class FakeBrowser extends EventEmitter {
  static launchGate: Promise<void> | null = null;
  static closeGate: Promise<void> | null = null;
  static constructed = 0;
  public id = `fake${++browserSeq}`;
  public closed = 0;
  constructor() {
    super();
    FakeBrowser.constructed++;
  }
  async launch() {
    if (FakeBrowser.launchGate) await FakeBrowser.launchGate;
  }
  wsEndpoint() {
    return `ws://127.0.0.1:1/devtools/browser/${this.id}`;
  }
  async close() {
    this.closed++;
    if (FakeBrowser.closeGate) await FakeBrowser.closeGate;
  }
  isRunning() {
    return true;
  }
  keepUntil() {
    return 0;
  }
}

const makeReq = (pathname: string, args?: string[]): Request => {
  const url = new URL(`http://127.0.0.1${pathname}`);
  // Caller-owned data dir: nothing temp for the mock to create or delete.
  url.searchParams.set(
    'launch',
    JSON.stringify({ args: args ?? ['--user-data-dir=/nonexistent-test-dir'] }),
  );
  return {
    headers: {},
    parsed: url,
    queryParams: {},
  } as unknown as Request;
};

const route = {
  browser: FakeBrowser,
  defaultLaunchOptions: {},
  path: '/chromium',
} as unknown as BrowserHTTPRoute;

const buildManager = (lifecycle: WorkerLifecycle) => {
  const hooks = Sinon.createStubInstance(Hooks);
  hooks.browser.resolves(undefined);
  hooks.page.resolves(undefined);
  const manager = new BrowserManager(new Config(), hooks, null as never);
  manager.setLifecycle(lifecycle);
  return { hooks, manager };
};

describe('WorkerLifecycle', () => {
  it('rejects new rights after withdraw; a right taken before stays counted and blocks retire', async () => {
    const lc = new WorkerLifecycle();
    const right = lc.acquireLaunch('x');
    lc.withdraw(expectFor(lc));

    expect(() => lc.acquireLaunch('x')).to.throw(WorkerWithdrawn);
    expect(lc.snapshot().launchPermits).to.deep.equal({ x: 1 });

    let snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.state).to.equal('withdrawn');
    expect(snap.reasons.join()).to.include('launch permit "x"');

    right.settle();
    right.settle(new Error('ignored: already settled'));
    snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.true;
    expect(snap.state).to.equal('admissionClosed');
    expect(() => lc.assertAttachAllowed()).to.throw(WorkerWithdrawn);
    expect(() => lc.resume(expectFor(lc))).to.throw(/Cannot resume/);
  });

  it('a request admitted before withdraw+resume cannot launch after resume', () => {
    const lc = new WorkerLifecycle();
    const oldReq = {};
    lc.stampAdmission(oldReq);
    lc.withdraw(expectFor(lc));
    lc.resume(expectFor(lc));

    expect(() => lc.acquireLaunch('x', { req: oldReq })).to.throw(
      WorkerWithdrawn,
      /admitted under generation 0/,
    );
    const newReq = {};
    lc.stampAdmission(newReq);
    expect(lc.acquireLaunch('x', { req: newReq }).settled).to.be.false;
  });

  it('adoption is honoured once and only while the outer right is unsettled', () => {
    const lc = new WorkerLifecycle();
    const outer = lc.acquireLaunch('outer');
    const other = lc.acquireLaunch('outer');
    other.settle();
    lc.withdraw(expectFor(lc)); // lands between outer acquire and nested SDK acquire

    // (a) nested acquire adopting the live outer right is admitted and counted.
    const inner = lc.acquireLaunch('sdk-launch', { adopt: outer });
    expect(lc.snapshot().launchPermits).to.deep.equal({
      outer: 1,
      'sdk-launch': 1,
    });
    // (c) a second adoption (concurrent/nested launch) and an unrelated
    // acquire are re-admitted, so rejected while withdrawn.
    expect(() => lc.acquireLaunch('sdk-launch', { adopt: outer })).to.throw(
      WorkerWithdrawn,
    );
    expect(() => lc.acquireLaunch('sdk-launch')).to.throw(WorkerWithdrawn);
    // (b) a settled right is never adoptable.
    expect(() => lc.acquireLaunch('sdk-launch', { adopt: other })).to.throw(
      WorkerWithdrawn,
    );
    inner.settle();
    expect(lc.snapshot().launchPermits).to.deep.equal({ outer: 1 });
    outer.settle();
    expect(() => lc.acquireLaunch('sdk-launch', { adopt: outer })).to.throw(
      WorkerWithdrawn,
    );
    expect(lc.snapshot().launchPermits).to.deep.equal({});
  });

  it('a required failure keeps completion blocked after all work settled; handler errors do not', async () => {
    const lc = new WorkerLifecycle();
    lc.track('handler', Promise.reject(new Error('request failed')), {
      required: false,
    }).catch(() => undefined);
    lc.track('cleanup', Promise.reject(new Error('close failed'))).catch(
      () => undefined,
    );
    await flush();
    lc.withdraw(expectFor(lc));
    const snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.tracked).to.deep.equal({});
    expect(snap.drainComplete).to.be.false;
    expect(snap.state).to.equal('admissionClosed');
    expect(snap.failures.map((f) => f.kind)).to.deep.equal(['cleanup']);
    expect((await lc.tryCloseAdmission(expectFor(lc))).drainComplete).to.be
      .false;
    expect(lc.markShutdownComplete()).to.be.false;
    try {
      await lc.tryCloseAdmission({ ...expectFor(lc), generation: 0 });
      expect.fail('stale generation accepted after closure');
    } catch (error) {
      expect(error).to.be.instanceOf(LifecycleConflict);
    }
  });

  it('bounds retained failure details without forgetting failures or permitting clean shutdown', async () => {
    const lc = new WorkerLifecycle();
    for (let i = 0; i < 105; i++)
      lc.recordFailure('cleanup', new Error(`failure ${i}`));
    lc.withdraw(expectFor(lc));
    const snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.equal(false);
    expect(snap.failures).to.have.length(100);
    expect(snap.failures[0].message).to.equal('failure 0');
    expect(snap.failures[99].message).to.equal('failure 99');
    expect(snap.failureCount).to.equal(105);
    expect(snap.reasons).to.have.length(101);
  });

  it('checks boot/generation, repeats idempotently and blocks on uncovered producers', async () => {
    const lc = new WorkerLifecycle();
    const g0 = expectFor(lc);
    expect(() => lc.withdraw({ ...g0, bootId: 'other' })).to.throw(/Expected/);
    expect(lc.withdraw(g0).generation).to.equal(1);
    expect(lc.withdraw(g0).generation).to.equal(1); // repeat of same request
    expect(() => lc.resume(g0)).to.throw(/Expected/); // stale generation
    lc.registerProducer('crawl', { covered: false, enabled: true });
    lc.registerProducer('agent', { covered: false, enabled: false });
    const snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.reasons).to.deep.equal([
      'producer "crawl" is enabled but not covered',
    ]);
  });
});

describe('BrowserManager drain (mock browsers)', () => {
  beforeEach(() => {
    FakeBrowser.launchGate = null;
    FakeBrowser.closeGate = null;
    FakeBrowser.constructed = 0;
  });

  it('a launch started before withdrawal finishes and stays counted; a delayed close blocks retire', async () => {
    const lc = new WorkerLifecycle();
    const { manager } = buildManager(lc);
    const launch = deferred();
    FakeBrowser.launchGate = launch.promise;

    const pending = manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
    );
    lc.withdraw(expectFor(lc));
    expect(lc.snapshot().launchPermits).to.deep.equal({ 'sdk-launch': 1 });
    expect((await lc.tryCloseAdmission(expectFor(lc))).drainComplete).to.be
      .false;

    launch.resolve();
    const browser = await pending;
    let snap = lc.snapshot();
    expect(snap.launchPermits).to.deep.equal({});
    expect(snap.sources['sdk-browsers']).to.equal(1);

    const close = deferred();
    FakeBrowser.closeGate = close.promise;
    await manager.complete(browser);
    snap = lc.snapshot();
    // Evicted from the browser map, but the close is still in flight.
    expect(snap.sources['sdk-browsers']).to.equal(0);
    expect(snap.tracked).to.deep.equal({ 'sdk-close': 1 });
    expect((await lc.tryCloseAdmission(expectFor(lc))).drainComplete).to.be
      .false;

    close.resolve();
    await drained(lc);
    snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete, snap.reasons.join('; ')).to.be.true;
  });

  it('after withdrawal: fresh and BLESS page launches are 503 with no browser; live reconnect works; missing target never falls back to launch', async () => {
    const lc = new WorkerLifecycle();
    const { manager } = buildManager(lc);
    const live = await manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
    );
    lc.withdraw(expectFor(lc));
    FakeBrowser.constructed = 0;

    for (const p of [
      '/chromium',
      `/devtools/page/${BLESS_PAGE_IDENTIFIER}-x`,
    ]) {
      const req = makeReq(p);
      expect(manager.isExistingBrowserRequest(req), p).to.be.false;
      const err = await manager
        .getBrowserForRequest(req, route, new Logger('test'))
        .catch((e) => e);
      expect(err, p).to.be.instanceOf(WorkerWithdrawn);
    }

    const reconnect = makeReq(
      `/devtools/browser/${(live as unknown as FakeBrowser).id}`,
    );
    expect(manager.isExistingBrowserRequest(reconnect)).to.be.true;
    expect(
      await manager.getBrowserForRequest(reconnect, route, new Logger('test')),
    ).to.equal(live);

    const missing = makeReq('/devtools/browser/fake-does-not-exist');
    expect(manager.isExistingBrowserRequest(missing)).to.be.true;
    const err = await manager
      .getBrowserForRequest(missing, route, new Logger('test'))
      .catch((e) => e);
    expect(err).to.be.instanceOf(NotFound);
    expect(FakeBrowser.constructed).to.equal(0);
  });

  it('honours an adopted pre-withdrawal outer right exactly once', async () => {
    const lc = new WorkerLifecycle();
    const { manager } = buildManager(lc);
    const outer = lc.acquireLaunch('outer');
    lc.withdraw(expectFor(lc)); // during the caller's own async preparation

    const browser = await manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
      outer,
    );
    expect(browser).to.be.instanceOf(FakeBrowser);
    expect(lc.snapshot().launchPermits).to.deep.equal({ outer: 1 });
    const second = await manager
      .getBrowserForRequest(
        makeReq('/chromium'),
        route,
        new Logger('test'),
        outer,
      )
      .catch((e) => e);
    expect(second).to.be.instanceOf(WorkerWithdrawn);
    outer.settle();
  });

  it('a launch failure whose cleanup close rejects settles the right and records the failure', async () => {
    const lc = new WorkerLifecycle();
    const { manager, hooks } = buildManager(lc);
    hooks.browser.rejects(new Error('browser hook failed'));
    FakeBrowser.closeGate = Promise.reject(new Error('kill failed'));
    FakeBrowser.closeGate.catch(() => undefined);

    const err = await manager
      .getBrowserForRequest(makeReq('/chromium'), route, new Logger('test'))
      .catch((e) => e);
    expect(err.message).to.equal('browser hook failed');
    const snap = lc.snapshot();
    expect(snap.launchPermits).to.deep.equal({});
    expect(snap.failures.map((f) => [f.kind, f.message])).to.deep.equal([
      ['sdk-launch', 'kill failed'],
    ]);
  });

  it('metadata: cache hits bypass the gate, cache misses are rejected while withdrawn', async () => {
    const lc = new WorkerLifecycle();
    const { manager } = buildManager(lc);
    lc.withdraw(expectFor(lc));
    const miss = await manager
      .getVersionJSON(new Logger('test'))
      .catch((e) => e);
    expect(miss).to.be.instanceOf(WorkerWithdrawn);
    const protocolMiss = await manager
      .getProtocolJSON(new Logger('test'))
      .catch((e) => e);
    expect(protocolMiss).to.be.instanceOf(WorkerWithdrawn);

    (manager as unknown as { protocolJSONCache: object }).protocolJSONCache = {
      cached: true,
    };
    expect(await manager.getProtocolJSON(new Logger('test'))).to.deep.equal({
      cached: true,
    });
  });

  it('tracks asynchronous route page hooks through fulfillment or rejection', async () => {
    for (const fails of [false, true]) {
      const lc = new WorkerLifecycle();
      const { manager } = buildManager(lc);
      const pending = deferred();
      const entered = deferred();
      const browser = await manager.getBrowserForRequest(
        makeReq('/chromium'),
        {
          ...route,
          onNewPage: async () => {
            entered.resolve();
            await pending.promise;
            if (fails) throw new Error('route page failed');
          },
        } as unknown as BrowserHTTPRoute,
        new Logger('test'),
      );
      const [listener] = browser.listeners('newPage');
      const handled = (listener as (p: unknown) => Promise<void>)({}).catch(
        (e) => e,
      );
      await entered.promise;
      await manager.complete(browser);
      await drained(lc, 'sdk-close');
      expect(lc.snapshot().tracked['sdk-close']).to.be.undefined;
      lc.withdraw(expectFor(lc));
      try {
        expect((await lc.tryCloseAdmission(expectFor(lc))).state).to.equal(
          'withdrawn',
        );
      } finally {
        pending.resolve();
        expect(await handled).to.be.undefined;
      }
      await lc.whenIdle();
      const report = await lc.tryCloseAdmission(expectFor(lc));
      expect(report.drainComplete).to.equal(!fails);
      expect(report.failures.map((f) => f.message)).to.deep.equal(
        fails ? ['route page failed'] : [],
      );
    }
  });

  it('contains rejected page hooks while retaining the lifecycle failure', async () => {
    const lc = new WorkerLifecycle();
    const { manager, hooks } = buildManager(lc);
    const browser = (await manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
    )) as unknown as FakeBrowser;
    hooks.page.rejects(new Error('page hook failed'));

    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      browser.emit('newPage', {});
      await lc.whenIdle();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).to.deep.equal([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }

    await manager.complete(browser as never);
    await drained(lc);
    lc.withdraw(expectFor(lc));
    const snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.reasons).to.deep.equal([
      'failed "page-hook": page hook failed',
    ]);
  });
});

class PendingBrowserRoute extends BrowserHTTPRoute {
  public accepts = [contentTypes.any];
  public auth = false;
  public browser = FakeBrowser as never;
  public contentTypes = [contentTypes.text];
  public description = 'test';
  public method = Methods.get;
  public name = 'pending-browser-route';
  public path: string | string[] = '/chromium';
  public tags: APITags[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(
    public override handler: any,
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

class PendingBrowserWSRoute extends BrowserWebsocketRoute {
  public auth = false;
  public browser = FakeBrowser as never;
  public description = 'test';
  public name = 'pending-browser-ws-route';
  public path: string | string[] = '/chromium';
  public tags: APITags[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public override handler: any) {
    super(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    this.concurrency = true;
  }
}

const makeSocket = () => {
  const written: string[] = [];
  return {
    end: (x?: string) => x && written.push(x),
    on: () => undefined,
    once: () => undefined,
    writable: true,
    write: (x: string) => written.push(x),
    written,
  };
};

const makeRes = () => {
  const res = Object.assign(new EventEmitter(), {
    code: 0,
    headersSent: false,
    socket: { writable: true },
    writable: true,
    writableEnded: false,
    end() {
      res.writableEnded = true;
      return res;
    },
    setHeader: () => res,
    write: () => true,
    writeHead(code: number) {
      res.code = code;
      res.headersSent = true;
      return res;
    },
  });
  return res;
};

const buildStack = ({ timeout = 0, concurrent = 5, queued = 5 } = {}) => {
  const lc = new WorkerLifecycle();
  const config = new Config();
  config.setConcurrent(concurrent);
  config.setQueued(queued);
  config.setTimeout(timeout);
  const hooks = Sinon.createStubInstance(Hooks);
  hooks.after.resolves(undefined);
  hooks.browser.resolves(undefined);
  const monitoring = new Monitoring(config);
  const limiter = new Limiter(
    config,
    new Metrics(),
    monitoring,
    Sinon.createStubInstance(WebHooks),
    hooks,
  );
  const manager = new BrowserManager(config, hooks, null as never);
  const router = new Router(config, manager, limiter, Logger, hooks);
  manager.setLifecycle(lc);
  limiter.setLifecycle(lc);
  router.setLifecycle(lc);
  return { config, hooks, lc, limiter, manager, monitoring, router };
};

describe('Router/Limiter drain (mock browsers, real modules)', () => {
  const monitorings: Monitoring[] = [];
  afterEach(() => {
    monitorings.forEach((m) => m.stop());
    monitorings.length = 0;
    FakeBrowser.closeGate = null;
  });
  const stack = (opts?: Parameters<typeof buildStack>[0]) => {
    const s = buildStack(opts);
    monitorings.push(s.monitoring);
    return s;
  };

  it('response close: the original handler outlives the response; retire waits for handler and close', async () => {
    const { lc, router } = stack();
    const handler = deferred();
    const entered = deferred();
    const r = router.registerHTTPRoute(
      new PendingBrowserRoute(() => {
        entered.resolve();
        return handler.promise;
      }),
    );
    const close = deferred();
    FakeBrowser.closeGate = close.promise;
    const res = makeRes();

    const request = run(r, makeReq('/chromium'), res);
    await entered.promise;
    res.emit('close'); // client went away before the handler wrote anything
    const err = (await request.catch((e: Error) => e)) as Error;
    expect(err.message).to.match(/closed prior to writing/);
    await flush();

    lc.withdraw(expectFor(lc));
    let snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.tracked).to.deep.equal({
      'route-handler': 1,
      'sdk-close': 1,
    });

    close.resolve();
    await drained(lc, 'sdk-close');
    snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.tracked).to.deep.equal({ 'route-handler': 1 });

    handler.resolve(); // late completion, long after the response closed
    await drained(lc);
    snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete, snap.reasons.join('; ')).to.be.true;
  });

  it('limiter timeout frees the queue slot, but the handler stays counted until it settles', async () => {
    const { lc, limiter, router } = stack({ timeout: 20 });
    const handler = deferred();
    const r = router.registerHTTPRoute(
      new PendingBrowserRoute(() => handler.promise, true),
    );
    const res = makeRes();
    run(r, makeReq('/chromium'), res);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(res.code).to.equal(408);
    expect(limiter.executing).to.equal(0);
    const snap = lc.snapshot();
    expect(snap.tracked['route-handler']).to.equal(1);
    lc.withdraw(expectFor(lc));
    expect((await lc.tryCloseAdmission(expectFor(lc))).drainComplete).to.be
      .false;

    handler.resolve();
    await drained(lc);
    const done = await lc.tryCloseAdmission(expectFor(lc));
    expect(done.reasons).to.deep.equal([]);
  });

  it('counts a delayed after-hook and records a rejected one', async () => {
    const { hooks, lc, router } = stack();
    const after = deferred<unknown>();
    hooks.after.returns(after.promise);
    const r = router.registerHTTPRoute(
      new PendingBrowserRoute(async () => 'ok'),
    );
    await run(r, makeReq('/chromium'), makeRes());
    await drained(lc, 'sdk-close');
    expect(lc.snapshot().tracked).to.deep.equal({ 'after-hook': 1 });

    after.reject(new Error('billing write failed'));
    await flush();
    lc.withdraw(expectFor(lc));
    const snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.reasons).to.deep.equal([
      'failed "after-hook": billing write failed',
    ]);
  });

  it('withdraw cancels queued fresh work, keeps queued reconnects, and resume does not revive it', async () => {
    const { lc, limiter } = stack({ concurrent: 1, queued: 5 });
    const running = deferred();
    const ran: string[] = [];
    const job = limiter.limit(
      async (req: Request) => {
        ran.push(req.parsed.pathname);
        if (req.parsed.pathname === '/first') await running.promise;
      },
      () => undefined,
      () => undefined,
      () => undefined,
    );
    // Router.setLifecycle wired withdraw -> limiter.rejectWaiting.

    const first = job(makeReq('/first'));
    await flush();
    const fresh = job(makeReq('/chromium')).catch((e) => e);
    const reconnect = job(makeReq('/devtools/browser/abc'));
    await flush();
    expect(lc.snapshot().sources['limiter-queued']).to.equal(2);

    lc.withdraw(expectFor(lc));
    expect(await fresh).to.be.instanceOf(WorkerWithdrawn);
    expect(lc.snapshot().sources['limiter-queued']).to.equal(1);
    lc.resume(expectFor(lc));

    running.resolve();
    await first;
    await reconnect;
    expect(ran).to.deep.equal(['/first', '/devtools/browser/abc']);
  });

  it('withdraw keeps queued non-browser routes but rejects queued browser routes', async () => {
    const { lc, limiter } = stack({ concurrent: 1, queued: 5 });
    const running = deferred();
    const ran: string[] = [];
    const makeJob = (browser: boolean) => {
      const route = new PendingBrowserRoute(async () => undefined, true);
      if (!browser) route.browser = null as never;
      return limiter.limit(
        async (req: Request) => {
          ran.push(req.parsed.pathname);
          if (req.parsed.pathname === '/first') await running.promise;
        },
        () => undefined,
        () => undefined,
        () => undefined,
        undefined,
        route,
      );
    };
    const plain = makeJob(false);
    const first = plain(makeReq('/first'));
    await flush();
    const kept = plain(makeReq('/plain')).catch((e) => e);
    const rejected = makeJob(true)(makeReq('/chromium')).catch((e) => e);
    await flush();
    lc.withdraw(expectFor(lc));
    running.resolve();
    await first;
    expect(await rejected).to.be.instanceOf(WorkerWithdrawn);
    expect(await kept).to.equal(undefined);
    expect(ran).to.deep.equal(['/first', '/plain']);
  });

  it('a request admitted before withdraw+resume (during the async health check) cannot launch when it executes', async () => {
    const { config, lc, limiter, monitoring } = stack();
    config.enableHealthChecks(true);
    const health = deferred<{
      cpuOverloaded: boolean;
      memoryOverloaded: boolean;
    }>();
    Sinon.stub(monitoring, 'overloaded').returns(health.promise as never);
    const job = limiter.limit(
      async (req: Request) => lc.acquireLaunch('sdk-launch', { req }),
      () => undefined,
      () => undefined,
      () => undefined,
    );
    const pending = job(makeReq('/chromium')).catch((e) => e);
    lc.withdraw(expectFor(lc));
    lc.resume(expectFor(lc));
    health.resolve({ cpuOverloaded: false, memoryOverloaded: false });
    expect(await pending).to.be.instanceOf(WorkerWithdrawn);
  });

  describe('early fresh-launch rejection', () => {
    it('rechecks admission after a pending health check before capacity or queueing', async () => {
      for (const [queued, overloaded] of [
        [0, false],
        [5, false],
        [0, true],
        [5, true],
      ] as const) {
        for (const resume of [false, true]) {
          const { config, lc, limiter, monitoring, router } = stack({
            concurrent: 1,
            queued,
          });
          const hold = deferred();
          const route = router.registerHTTPRoute(
            new PendingBrowserRoute(() => hold.promise, true),
          );
          const running = run(route, makeReq('/chromium'), makeRes());
          await flush();
          config.enableHealthChecks(true);
          const health = deferred<{
            cpuOverloaded: boolean;
            memoryOverloaded: boolean;
          }>();
          Sinon.stub(monitoring, 'overloaded').returns(health.promise as never);
          const res = makeRes();
          let error: unknown;
          const waiting = run(route, makeReq('/chromium'), res).catch((e) => {
            error = e;
          });
          lc.withdraw(expectFor(lc));
          if (resume) lc.resume(expectFor(lc));
          health.resolve({
            cpuOverloaded: overloaded,
            memoryOverloaded: false,
          });
          await flush();
          try {
            expect(error).to.be.instanceOf(WorkerWithdrawn);
            expect(res.code).to.equal(0);
            expect(limiter.waiting).to.equal(0);
          } finally {
            hold.resolve();
            await Promise.allSettled([running, waiting]);
          }
        }
      }
    });

    // One running job occupies the only concurrency slot.
    const occupied = (queued: number) => {
      const s = stack({ concurrent: 1, queued });
      const hold = deferred();
      const r = s.router.registerHTTPRoute(
        new PendingBrowserRoute(() => hold.promise, true),
      );
      run(r, makeReq('/chromium'), makeRes());
      return { ...s, hold, r };
    };

    for (const queued of [0, 5]) {
      it(`withdrawn: a fresh HTTP launch is 503 immediately, never 429 or queued (queue room ${queued})`, async () => {
        const { hold, lc, limiter, r } = occupied(queued);
        await flush();
        expect(limiter.executing).to.equal(1);
        lc.withdraw(expectFor(lc));
        const res = makeRes();
        const constructed = FakeBrowser.constructed;
        const err = await run(r, makeReq('/chromium'), res).catch((e) => e);
        expect(err).to.be.instanceOf(WorkerWithdrawn);
        expect(res.code).to.equal(0); // overCapacity 429 writer not called
        expect(limiter.length).to.equal(1); // nothing enqueued
        expect(lc.snapshot().sources['limiter-queued']).to.equal(0);
        expect(FakeBrowser.constructed).to.equal(constructed);
        hold.resolve();
      });
    }

    it('withdrawn: a fresh WebSocket launch is 503 before limiter admission', async () => {
      const { lc, limiter, router } = stack({ concurrent: 1, queued: 0 });
      const hold = deferred();
      const r = router.registerWebSocketRoute(
        new PendingBrowserWSRoute(() => hold.promise),
      );
      const call = (path: string, socket = makeSocket()) =>
        (r.handler as (...a: unknown[]) => Promise<unknown>)(
          makeReq(path),
          socket,
          Buffer.alloc(0),
        );
      call('/chromium');
      await flush();
      lc.withdraw(expectFor(lc));
      const socket = makeSocket();
      const err = await call('/chromium', socket).catch((e) => e);
      expect(err).to.be.instanceOf(WorkerWithdrawn);
      expect(socket.written.join('')).to.not.include('429');
      expect(limiter.length).to.equal(1);
      hold.resolve();
    });

    it('withdrawn: existing-browser requests keep the normal path (429 at capacity, liveness checked with room)', async () => {
      const { hold, lc, limiter, r } = occupied(0);
      await flush();
      lc.withdraw(expectFor(lc));
      const atCapacity = await run(
        r,
        makeReq('/devtools/browser/fake-missing'),
        makeRes(),
      ).catch((e) => e);
      expect(atCapacity).to.be.instanceOf(TooManyRequests);
      const freed = new Promise<void>((resolve) =>
        limiter.addEventListener('success', () => resolve(), { once: true }),
      );
      hold.resolve();
      await freed;
      // Room available: still resolved against live browsers, no fallback launch.
      const constructed = FakeBrowser.constructed;
      const missing = await run(
        r,
        makeReq('/devtools/browser/fake-missing'),
        makeRes(),
      ).catch((e) => e);
      expect(missing).to.be.instanceOf(NotFound);
      expect(FakeBrowser.constructed).to.equal(constructed);
    });

    it('running: capacity behaviour is unchanged (fresh launch gets 429)', async () => {
      const { hold, r } = occupied(0);
      await flush();
      const res = makeRes();
      const err = await run(r, makeReq('/chromium'), res).catch((e) => e);
      expect(err).to.be.instanceOf(TooManyRequests);
      expect(res.code).to.equal(429);
      hold.resolve();
    });
  });

  it('serves WorkerWithdrawn as 503 on both HTTP responses and WebSocket upgrade sockets', () => {
    class TestServer extends HTTPServer {
      public fail(e: Error, res: unknown) {
        return this.handleErrorRequest(e, res as never);
      }
    }
    const config = new Config();
    const server = new TestServer(
      config,
      new Metrics(),
      new Token(config),
      null as never,
      new Hooks(),
      Logger,
    );
    const res = makeRes();
    server.fail(new WorkerWithdrawn(), res);
    expect(res.code).to.equal(503);

    const written: string[] = [];
    const socket = {
      end: (s?: string) => s && written.push(s),
      writable: true,
      write: (s: string) => written.push(s),
    };
    server.fail(new WorkerWithdrawn(), socket);
    expect(written.join('')).to.include('HTTP/1.1 503');
  });
});

describe('Job authority', () => {
  beforeEach(() => {
    FakeBrowser.launchGate = null;
    FakeBrowser.closeGate = null;
    FakeBrowser.constructed = 0;
  });

  it('is created only while running, with or without a request, and never after the acceptance fence', () => {
    const lc = new WorkerLifecycle();
    const a = lc.createJobLaunchAuthority('crawl', { owner: {} });
    expect(lc.snapshot().launchPermits).to.deep.equal({ 'job:crawl': 1 });

    const oldReq = {};
    lc.stampAdmission(oldReq);
    lc.withdraw(expectFor(lc));
    expect(() => lc.createJobLaunchAuthority('crawl', { owner: {} })).to.throw(
      WorkerWithdrawn,
    );
    lc.resume(expectFor(lc));
    // admitted before withdraw+resume: the fence is the generation, not the state
    expect(() =>
      lc.createJobLaunchAuthority('crawl', { owner: {}, req: oldReq }),
    ).to.throw(WorkerWithdrawn, /admitted under generation 0/);
    a.settle();
  });

  it('one authority per owner and per request, ever (no reuse after settle)', () => {
    const lc = new WorkerLifecycle();
    const owner = {};
    const req = {};
    lc.createJobLaunchAuthority('agent', { owner, req }).settle();
    expect(() => lc.createJobLaunchAuthority('agent', { owner })).to.throw(
      LifecycleConflict,
    );
    expect(() =>
      lc.createJobLaunchAuthority('agent', { owner: {}, req }),
    ).to.throw(LifecycleConflict);
  });

  it('adopts repeatedly while unsettled, across withdrawal between child launches; each child is counted', () => {
    const lc = new WorkerLifecycle();
    const a = lc.createJobLaunchAuthority('crawl', { owner: {} });
    const c1 = lc.acquireLaunch('bql', { adopt: a });
    lc.withdraw(expectFor(lc));
    const c2 = lc.acquireLaunch('bql', { adopt: a });
    const c3 = lc.acquireLaunch('bql', { adopt: a });
    expect(lc.snapshot().launchPermits).to.deep.equal({
      bql: 3,
      'job:crawl': 1,
    });
    // ordinary acquisitions are still refused while withdrawn
    expect(() => lc.acquireLaunch('bql')).to.throw(WorkerWithdrawn);
    [c1, c2, c3].forEach((c) => c.settle());
    expect(lc.snapshot().launchPermits).to.deep.equal({ 'job:crawl': 1 });
    a.settle();
  });

  it('settling the authority with a live child keeps the child counted; settle is idempotent and irrevocable', async () => {
    const lc = new WorkerLifecycle();
    const a = lc.createJobLaunchAuthority('bundle', { owner: {} });
    const child = lc.acquireLaunch('bql', { adopt: a });
    lc.withdraw(expectFor(lc));
    a.settle();
    a.settle(new Error('ignored: already settled'));
    let snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.state).to.equal('withdrawn');
    expect(snap.launchPermits).to.deep.equal({ bql: 1 });
    expect(snap.failures).to.deep.equal([]);
    expect(() => lc.acquireLaunch('bql', { adopt: a })).to.throw(
      WorkerWithdrawn,
    );
    child.settle();
    snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete, snap.reasons.join('; ')).to.be.true;
  });

  it('an unsettled authority blocks retire and whenIdle; a failed settlement is recorded', async () => {
    const lc = new WorkerLifecycle();
    const a = lc.createJobLaunchAuthority('background-task', { owner: {} });
    lc.withdraw(expectFor(lc));
    expect((await lc.tryCloseAdmission(expectFor(lc))).reasons).to.deep.equal([
      '1 outstanding launch permit "job:background-task"',
    ]);
    let idle = false;
    lc.whenIdle().then(() => (idle = true));
    await flush();
    expect(idle).to.be.false;
    a.settle(new Error('profile capture failed'));
    await flush();
    expect(idle).to.be.true;
    const snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete).to.be.false;
    expect(snap.reasons).to.deep.equal([
      'failed "job:background-task": profile capture failed',
    ]);
  });

  it('stale, foreign and ordinary rights do not act as authorities', () => {
    const lc = new WorkerLifecycle();
    const other = new WorkerLifecycle();
    const foreign = other.createJobLaunchAuthority('crawl', { owner: {} });
    const settled = lc.createJobLaunchAuthority('crawl', { owner: {} });
    settled.settle();
    const ordinary = lc.acquireLaunch('x');
    lc.acquireLaunch('x', { adopt: ordinary }).settle(); // single use, unchanged
    lc.withdraw(expectFor(lc));
    for (const adopt of [foreign, settled, ordinary]) {
      expect(() => lc.acquireLaunch('bql', { adopt })).to.throw(
        WorkerWithdrawn,
      );
    }
    expect(other.snapshot().launchPermits).to.deep.equal({ 'job:crawl': 1 });
    foreign.settle();
    ordinary.settle();
  });

  it('through BrowserManager: repeated launches after withdrawal, settle racing an in-flight launch, then refused', async () => {
    const lc = new WorkerLifecycle();
    const { manager } = buildManager(lc);
    const a = lc.createJobLaunchAuthority('crawl', { owner: {} });
    lc.withdraw(expectFor(lc));
    const b1 = await manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
      a,
    );
    const launch = deferred();
    FakeBrowser.launchGate = launch.promise;
    const pending = manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
      a,
    );
    await flush();
    a.settle(); // the job ends while its second launch is still in flight
    expect(lc.snapshot().launchPermits).to.deep.equal({ 'sdk-launch': 1 });
    launch.resolve();
    const b2 = await pending;
    expect(lc.snapshot().sources['sdk-browsers']).to.equal(2);
    expect(lc.snapshot().launchPermits).to.deep.equal({});
    const refused = await manager
      .getBrowserForRequest(makeReq('/chromium'), route, new Logger('test'), a)
      .catch((e) => e);
    expect(refused).to.be.instanceOf(WorkerWithdrawn);
    expect(FakeBrowser.constructed).to.equal(2);

    // late cleanup after the authority settled stays counted
    const close = deferred();
    FakeBrowser.closeGate = close.promise;
    await manager.complete(b1);
    await manager.complete(b2);
    let snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.state).to.equal('withdrawn');
    expect(snap.tracked).to.deep.equal({ 'sdk-close': 2 });
    close.resolve();
    await drained(lc);
    snap = await lc.tryCloseAdmission(expectFor(lc));
    expect(snap.drainComplete, snap.reasons.join('; ')).to.be.true;
  });

  it('a child launch whose cleanup fails is recorded; the authority stays usable until settled', async () => {
    const lc = new WorkerLifecycle();
    const { hooks, manager } = buildManager(lc);
    const a = lc.createJobLaunchAuthority('bundle', { owner: {} });
    lc.withdraw(expectFor(lc));
    hooks.browser.onFirstCall().rejects(new Error('browser hook failed'));
    FakeBrowser.closeGate = Promise.reject(new Error('kill failed'));
    FakeBrowser.closeGate.catch(() => undefined);
    const err = await manager
      .getBrowserForRequest(makeReq('/chromium'), route, new Logger('test'), a)
      .catch((e) => e);
    expect(err.message).to.equal('browser hook failed');
    FakeBrowser.closeGate = null;
    const ok = await manager.getBrowserForRequest(
      makeReq('/chromium'),
      route,
      new Logger('test'),
      a,
    );
    expect(ok).to.be.instanceOf(FakeBrowser);
    a.settle();
    expect(
      lc.snapshot().failures.map((f) => [f.kind, f.message]),
    ).to.deep.equal([['sdk-launch', 'kill failed']]);
  });
});
