import {
  Config,
  HTTPRoute,
  HTTPServer,
  Hooks,
  Logger,
  Metrics,
  Request,
  Router,
  Token,
  WebSocketRoute,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import Sinon from 'sinon';
import { expect } from 'chai';
import getPort from 'get-port';
import { request as httpRequest } from 'http';

describe('Function-valued route authentication', () => {
  const config = new Config();
  config.setToken('first-test-token');
  config.setStrictTokenUse(false);
  const token = new Token(config);
  const request = (value?: string) =>
    ({
      headers: {},
      parsed: new URL(`http://localhost/${value ? `?token=${value}` : ''}`),
    }) as Request;

  it('awaits a request-dependent policy before checking configured tokens', async () => {
    const route = {
      name: 'ConditionalRoute',
      async auth(req: Request) {
        await Promise.resolve();
        return req.parsed.pathname === '/protected';
      },
    } as unknown as HTTPRoute;
    const req = request();
    req.parsed.pathname = '/protected';
    expect(await token.isAuthorized(req, route)).to.equal(false);
    req.parsed.searchParams.set('token', 'wrong');
    expect(await token.isAuthorized(req, route)).to.equal(false);
    req.parsed.searchParams.set('token', 'first-test-token');
    expect(await token.isAuthorized(req, route)).to.equal(true);
    expect(await token.isAuthorized(request(), route)).to.equal(true);
  });

  for (const auth of [
    () => {
      throw new Error('policy failure');
    },
    async () => {
      throw new Error('policy failure');
    },
  ]) {
    it(`denies access when the policy ${auth.constructor.name === 'AsyncFunction' ? 'rejects' : 'throws'}`, async () => {
      expect(
        await token.isAuthorized(request('first-test-token'), {
          auth,
          name: 'BrokenPolicyRoute',
        } as unknown as HTTPRoute),
      ).to.equal(false);
    });
  }

  it('preserves the route receiver for policy methods', async () => {
    const route = {
      name: 'ProtectedRoute',
      async auth(this: { name: string }) {
        return this.name === 'ProtectedRoute';
      },
    } as unknown as HTTPRoute;
    expect(await token.isAuthorized(request(), route)).to.equal(false);
  });

  it('leaves policies inert when no token is configured', async () => {
    const config = new Config();
    config.setToken(null);
    expect(
      await new Token(config).isAuthorized(request(), {
        name: 'NoTokenRoute',
        auth: async () => {
          throw new Error('policy must not run');
        },
      } as unknown as HTTPRoute),
    ).to.equal(true);
  });

  describe('HTTP and WebSocket admission', () => {
    let server: HTTPServer;
    let port: number;
    let config: Config;
    const route = {
      name: 'ConditionalRoute',
      accepts: [contentTypes.any],
      async auth(req: Request) {
        if (req.parsed.pathname === '/error') throw new Error('policy failure');
        return req.parsed.pathname !== '/public';
      },
      async handler(_req: Request, res: Parameters<typeof writeResponse>[0]) {
        writeResponse(res, 200, 'handler reached');
      },
    } as unknown as HTTPRoute;

    beforeEach(async () => {
      config = new Config();
      config.setToken('local-test-token');
      config.setStrictTokenUse(false);
      port = await getPort();
      config.setPort(port);
      const router = Sinon.createStubInstance(Router);
      router.getRouteForHTTPRequest.resolves(route);
      router.getRouteForWebSocketRequest.resolves(
        route as unknown as WebSocketRoute,
      );
      server = new HTTPServer(
        config,
        new Metrics(),
        new Token(config),
        router,
        new Hooks(),
        Logger,
      );
      await server.start();
    });

    afterEach(async () => {
      await server.shutdown();
    });

    for (const [upgrade, strict] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      it(`enforces callback policies on ${upgrade ? 'WebSocket upgrades' : 'HTTP requests'} (strict=${strict})`, async () => {
        config.setStrictTokenUse(strict);
        const status = (path: string) =>
          new Promise<number>((resolve, reject) => {
            httpRequest(
              {
                port,
                path,
                headers: upgrade
                  ? { Connection: 'Upgrade', Upgrade: 'websocket' }
                  : {},
              },
              (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode!));
              },
            )
              .on('error', reject)
              .end();
          });
        expect(await status('/protected')).to.equal(401);
        expect(await status('/protected?token=wrong')).to.equal(401);
        expect(await status('/protected?token=local-test-token')).to.equal(200);
        expect(await status('/public')).to.equal(strict ? 401 : 200);
        expect(await status('/public?token=local-test-token')).to.equal(200);
        expect(await status('/error?token=local-test-token')).to.equal(
          strict ? 200 : 401,
        );
      });
    }
  });
});
