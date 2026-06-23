/* eslint-disable no-unused-expressions */
import * as http from 'http';
import * as stream from 'stream';
import {
  APITags,
  BrowserManager,
  Config,
  HTTPRoute,
  Hooks,
  Limiter,
  Logger,
  Methods,
  Metrics,
  Monitoring,
  Request,
  Router,
  WebHooks,
  WebSocketRoute,
  contentTypes,
} from '@browserless.io/browserless';
import Sinon, { spy } from 'sinon';
import { expect } from 'chai';

const monitorings: Monitoring[] = [];
const trackMonitoring = (m: Monitoring): Monitoring => {
  monitorings.push(m);
  return m;
};

class TestHTTPRoute extends HTTPRoute {
  public accepts = [contentTypes.any];
  public auth = false;
  public contentTypes = [contentTypes.text];
  public description = 'test';
  public method = Methods.get;
  public name = 'test-http';
  public path: string | string[] = '/__test__';
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
  }
}

class TestWebSocketRoute extends WebSocketRoute {
  public auth = false;
  public description = 'test';
  public name = 'test-ws';
  public path: string | string[] = '/__test_ws__';
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
  }
}

const makeRequest = (): Request => {
  const req = new http.IncomingMessage(
    null as unknown as import('net').Socket,
  ) as Request;
  req.url = '/__test__';
  req.method = 'GET';
  req.parsed = new URL('http://localhost/__test__');
  req.body = undefined;
  req.queryParams = {};
  return req;
};

const makeResponse = (): http.ServerResponse => {
  // Must look like an http.ServerResponse (writeHead present) and have a
  // writable socket so the router treats it as a live HTTP connection.
  const fake = {
    writable: true,
    writableEnded: false,
    socket: { writable: true },
    writeHead: () => fake,
    end: () => fake,
    write: () => true,
    once: () => fake,
    on: () => fake,
    setHeader: () => fake,
    removeHeader: () => fake,
    getHeader: () => undefined,
  };
  return fake as unknown as http.ServerResponse;
};

const makeSocket = (): stream.Duplex => {
  const fake = {
    writable: true,
    end: () => fake,
    write: () => true,
    once: () => fake,
    on: () => fake,
    destroy: () => fake,
  };
  return fake as unknown as stream.Duplex;
};

const buildRouter = () => {
  const config = new Config();
  config.setConcurrent(2);
  config.setQueued(2);
  config.setTimeout(-1);

  const metrics = new Metrics();
  const monitoring = trackMonitoring(new Monitoring(config));
  const webhooks = Sinon.createStubInstance(WebHooks);
  const hooks = Sinon.createStubInstance(Hooks);
  hooks.after.resolves(undefined);
  const limiter = new Limiter(config, metrics, monitoring, webhooks, hooks);
  const browserManager = Sinon.createStubInstance(BrowserManager);

  const router = new Router(config, browserManager, limiter, Logger, hooks);

  return { router, hooks, limiter, config, metrics };
};

// Resolves when the Limiter dispatches its next 'end' event. Used to wait
// deterministically for the queue's async success/error path to fire after().
const limiterEnded = (limiter: Limiter): Promise<void> =>
  new Promise<void>((resolve) => {
    limiter.addEventListener('end', () => resolve());
  });

// Lets queued microtasks drain — used after firing a route handler so that
// fire-and-forget paths like `Promise.resolve().then(...).catch(...)` inside
// fireAfterHook have a chance to settle before we assert.
const flushMicrotasks = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('Router', () => {
  afterEach(() => {
    monitorings.forEach((m) => m.stop());
    monitorings.length = 0;
  });

  describe('HTTP route after() lifecycle', () => {
    it('fires after() once with status "successful" for concurrency=true routes', async () => {
      const { router, hooks, limiter } = buildRouter();
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = true;
      router.registerHTTPRoute(route);

      const ended = limiterEnded(limiter);
      await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());
      await ended;

      expect(inner.calledOnce).to.be.true;
      expect(hooks.after.callCount).to.equal(1);
      expect(hooks.after.firstCall.args[0]).to.have.property(
        'status',
        'successful',
      );
    });

    it('fires after() once with status "successful" for concurrency=false routes', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = false;
      router.registerHTTPRoute(route);

      await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());

      expect(inner.calledOnce).to.be.true;
      expect(hooks.after.callCount).to.equal(1);
      expect(hooks.after.firstCall.args[0]).to.have.property(
        'status',
        'successful',
      );
    });

    it('fires after() exactly once with status "error" when handler rejects (concurrency=false)', async () => {
      const { router, hooks } = buildRouter();
      const boom = new Error('boom');
      const inner = spy(async () => {
        throw boom;
      });
      const route = new TestHTTPRoute(inner);
      route.concurrency = false;
      router.registerHTTPRoute(route);

      let caught: unknown;
      try {
        await (
          route.handler as (
            req: Request,
            res: http.ServerResponse,
          ) => Promise<unknown>
        )(makeRequest(), makeResponse());
      } catch (err) {
        caught = err;
      }

      expect(caught).to.equal(boom);
      expect(hooks.after.callCount).to.equal(1);
      const payload = hooks.after.firstCall.args[0];
      expect(payload).to.have.property('status', 'error');
      expect(payload).to.have.property('error', boom);
    });

    it('fires after() exactly once (no double-fire) for concurrency=true routes', async () => {
      const { router, hooks, limiter } = buildRouter();
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = true;
      router.registerHTTPRoute(route);

      const ended = limiterEnded(limiter);
      await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());
      await ended;

      expect(hooks.after.callCount).to.equal(1);
    });

    it('does not propagate when hooks.after throws synchronously (concurrency=false)', async () => {
      const { router, hooks } = buildRouter();
      hooks.after.throws(new Error('hook-sync-boom'));
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = false;
      router.registerHTTPRoute(route);

      const result = await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());
      await flushMicrotasks();

      expect(inner.calledOnce).to.be.true;
      expect(result).to.equal('ok');
    });

    it('does not propagate when hooks.after returns a rejected promise (concurrency=false)', async () => {
      const { router, hooks } = buildRouter();
      hooks.after.rejects(new Error('hook-async-boom'));
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = false;
      router.registerHTTPRoute(route);

      const result = await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());
      await flushMicrotasks();

      expect(inner.calledOnce).to.be.true;
      expect(result).to.equal('ok');
    });

    it('skips after() when the response was already closed before the handler ran (concurrency=false)', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = false;
      router.registerHTTPRoute(route);

      const closedRes = makeResponse();
      // Simulate a client that has already disconnected.
      (closedRes.socket as { writable: boolean }).writable = false;

      await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), closedRes);

      expect(inner.called).to.be.false;
      expect(hooks.after.callCount).to.equal(0);
    });
  });

  describe('WebSocket route after() lifecycle', () => {
    it('fires after() once with status "successful" for concurrency=true routes', async () => {
      const { router, hooks, limiter } = buildRouter();
      const inner = spy(async () => undefined);
      const route = new TestWebSocketRoute(inner);
      route.concurrency = true;
      router.registerWebSocketRoute(route);

      const ended = limiterEnded(limiter);
      await (
        route.handler as (
          req: Request,
          socket: stream.Duplex,
          head: Buffer,
        ) => Promise<unknown>
      )(makeRequest(), makeSocket(), Buffer.alloc(0));
      await ended;

      expect(inner.calledOnce).to.be.true;
      expect(hooks.after.callCount).to.equal(1);
      expect(hooks.after.firstCall.args[0]).to.have.property(
        'status',
        'successful',
      );
    });

    it('fires after() once with status "successful" for concurrency=false routes', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => undefined);
      const route = new TestWebSocketRoute(inner);
      route.concurrency = false;
      router.registerWebSocketRoute(route);

      await (
        route.handler as (
          req: Request,
          socket: stream.Duplex,
          head: Buffer,
        ) => Promise<unknown>
      )(makeRequest(), makeSocket(), Buffer.alloc(0));

      expect(inner.calledOnce).to.be.true;
      expect(hooks.after.callCount).to.equal(1);
      expect(hooks.after.firstCall.args[0]).to.have.property(
        'status',
        'successful',
      );
    });

    it('fires after() exactly once with status "error" when handler rejects (concurrency=false)', async () => {
      const { router, hooks } = buildRouter();
      const boom = new Error('ws-boom');
      const inner = spy(async () => {
        throw boom;
      });
      const route = new TestWebSocketRoute(inner);
      route.concurrency = false;
      router.registerWebSocketRoute(route);

      let caught: unknown;
      try {
        await (
          route.handler as (
            req: Request,
            socket: stream.Duplex,
            head: Buffer,
          ) => Promise<unknown>
        )(makeRequest(), makeSocket(), Buffer.alloc(0));
      } catch (err) {
        caught = err;
      }

      expect(caught).to.equal(boom);
      expect(hooks.after.callCount).to.equal(1);
      const payload = hooks.after.firstCall.args[0];
      expect(payload).to.have.property('status', 'error');
      expect(payload).to.have.property('error', boom);
    });

    it('fires after() exactly once (no double-fire) for concurrency=true routes', async () => {
      const { router, hooks, limiter } = buildRouter();
      const inner = spy(async () => undefined);
      const route = new TestWebSocketRoute(inner);
      route.concurrency = true;
      router.registerWebSocketRoute(route);

      const ended = limiterEnded(limiter);
      await (
        route.handler as (
          req: Request,
          socket: stream.Duplex,
          head: Buffer,
        ) => Promise<unknown>
      )(makeRequest(), makeSocket(), Buffer.alloc(0));
      await ended;

      expect(hooks.after.callCount).to.equal(1);
    });

    it('skips after() when the socket was already closed before the handler ran (concurrency=false)', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => undefined);
      const route = new TestWebSocketRoute(inner);
      route.concurrency = false;
      router.registerWebSocketRoute(route);

      const closedSocket = makeSocket();
      (closedSocket as { writable: boolean }).writable = false;

      await (
        route.handler as (
          req: Request,
          socket: stream.Duplex,
          head: Buffer,
        ) => Promise<unknown>
      )(makeRequest(), closedSocket, Buffer.alloc(0));

      expect(inner.called).to.be.false;
      expect(hooks.after.callCount).to.equal(0);
    });
  });
});
