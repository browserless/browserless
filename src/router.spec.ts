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
  sleep,
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
  // A minimal fake ServerResponse. We need `writeHead` (used by isHTTP) and
  // `socket.writable = true` (used by isConnected) to be present.
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

describe('Router', () => {
  afterEach(() => {
    monitorings.forEach((m) => m.stop());
    monitorings.length = 0;
  });

  describe('HTTP route after() lifecycle', () => {
    it('fires after() once with status "successful" for concurrency=true routes', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = true;
      router.registerHTTPRoute(route);

      await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());
      // Wait a tick so queue 'success' event handlers can fire after-hook.
      await sleep(10);

      expect(inner.calledOnce).to.be.true;
      expect(hooks.after.calledOnce).to.be.true;
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
      expect(hooks.after.calledOnce).to.be.true;
      expect(hooks.after.firstCall.args[0]).to.have.property(
        'status',
        'successful',
      );
    });

    it('fires after() once with status "error" when handler rejects (concurrency=false)', async () => {
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
      expect(hooks.after.calledOnce).to.be.true;
      const payload = hooks.after.firstCall.args[0];
      expect(payload).to.have.property('status', 'error');
      expect(payload).to.have.property('error', boom);
    });

    it('fires after() exactly once (no double-fire) for concurrency=true routes', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => 'ok');
      const route = new TestHTTPRoute(inner);
      route.concurrency = true;
      router.registerHTTPRoute(route);

      await (
        route.handler as (
          req: Request,
          res: http.ServerResponse,
        ) => Promise<unknown>
      )(makeRequest(), makeResponse());
      await sleep(10);

      expect(hooks.after.callCount).to.equal(1);
    });
  });

  describe('WebSocket route after() lifecycle', () => {
    it('fires after() once with status "successful" for concurrency=true routes', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => undefined);
      const route = new TestWebSocketRoute(inner);
      route.concurrency = true;
      router.registerWebSocketRoute(route);

      await (
        route.handler as (
          req: Request,
          socket: stream.Duplex,
          head: Buffer,
        ) => Promise<unknown>
      )(makeRequest(), makeSocket(), Buffer.alloc(0));
      await sleep(10);

      expect(inner.calledOnce).to.be.true;
      expect(hooks.after.calledOnce).to.be.true;
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
      expect(hooks.after.calledOnce).to.be.true;
      expect(hooks.after.firstCall.args[0]).to.have.property(
        'status',
        'successful',
      );
    });

    it('fires after() once with status "error" when handler rejects (concurrency=false)', async () => {
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
      expect(hooks.after.calledOnce).to.be.true;
      const payload = hooks.after.firstCall.args[0];
      expect(payload).to.have.property('status', 'error');
      expect(payload).to.have.property('error', boom);
    });

    it('fires after() exactly once (no double-fire) for concurrency=true routes', async () => {
      const { router, hooks } = buildRouter();
      const inner = spy(async () => undefined);
      const route = new TestWebSocketRoute(inner);
      route.concurrency = true;
      router.registerWebSocketRoute(route);

      await (
        route.handler as (
          req: Request,
          socket: stream.Duplex,
          head: Buffer,
        ) => Promise<unknown>
      )(makeRequest(), makeSocket(), Buffer.alloc(0));
      await sleep(10);

      expect(hooks.after.callCount).to.equal(1);
    });
  });
});
