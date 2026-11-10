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
    let route: HTTPRoute;

    beforeEach(async () => {
      route = {
        name: 'ConditionalRoute',
        accepts: [contentTypes.any],
        async auth(req: Request) {
          if (req.parsed.pathname === '/error')
            throw new Error('policy failure');
          return req.parsed.pathname !== '/public';
        },
        async handler(_req: Request, res: Parameters<typeof writeResponse>[0]) {
          writeResponse(res, 200, 'handler reached');
        },
      } as unknown as HTTPRoute;
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

    const status = (path: string, upgrade = false) =>
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

    for (const upgrade of [false, true]) {
      it(`supplies validated query parameters to ${upgrade ? 'WebSocket' : 'HTTP'} policies`, async () => {
        route.querySchema = {
          type: 'object',
          properties: { private: { type: 'boolean' } },
          required: ['private'],
        };
        route.auth = async (req) => req.queryParams?.private === true;
        expect(await status('/query?private=true', upgrade)).to.equal(401);
        expect(await status('/query?private=false', upgrade)).to.equal(200);
        expect(
          await status('/query?private=true&token=local-test-token', upgrade),
        ).to.equal(200);
        expect(await status('/query?private=invalid', upgrade)).to.equal(400);
      });
    }

    for (const method of ['POST', 'GET']) {
      it(`supplies the validated ${method} body to the policy and handler`, async () => {
        config.enableGETRequests(true);
        route.bodySchema = {
          type: 'object',
          properties: { private: { type: 'boolean' } },
          required: ['private'],
        };
        route.auth = async (req) =>
          (req.body as { private?: boolean })?.private === true;
        route.before = async (req) => {
          // Hooks still run before parsing (GET helpers supply a raw string).
          expect(typeof req.body).to.equal(
            method === 'GET' ? 'string' : 'undefined',
          );
          return true;
        };
        route.handler = async (req, res) => {
          writeResponse(res, 200, JSON.stringify(req.body), contentTypes.json);
        };
        const send = (value: string, token = '') => {
          const url = new URL(`http://localhost:${port}/body`);
          if (token) url.searchParams.set('token', token);
          const body = JSON.stringify({ private: value });
          if (method === 'GET') url.searchParams.set('body', body);
          return fetch(url, {
            method,
            headers: { 'content-type': contentTypes.json },
            ...(method === 'POST' ? { body } : {}),
          });
        };
        expect((await send('true')).status).to.equal(401);
        const authorized = await send('true', 'local-test-token');
        expect(authorized.status).to.equal(200);
        expect(await authorized.json()).to.deep.equal({ private: true });
        const publicResponse = await send('false');
        expect(publicResponse.status).to.equal(200);
        expect(await publicResponse.json()).to.deep.equal({ private: false });
        expect((await send('invalid')).status).to.equal(400);
        config.setStrictTokenUse(true);
        expect((await send('invalid')).status).to.equal(401);
      });
    }

    for (const [upgrade, strict] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      it(`enforces callback policies on ${upgrade ? 'WebSocket upgrades' : 'HTTP requests'} (strict=${strict})`, async () => {
        config.setStrictTokenUse(strict);
        expect(await status('/protected', upgrade)).to.equal(401);
        expect(await status('/protected?token=wrong', upgrade)).to.equal(401);
        expect(
          await status('/protected?token=local-test-token', upgrade),
        ).to.equal(200);
        expect(await status('/public', upgrade)).to.equal(strict ? 401 : 200);
        expect(
          await status('/public?token=local-test-token', upgrade),
        ).to.equal(200);
        expect(await status('/error?token=local-test-token', upgrade)).to.equal(
          strict ? 200 : 401,
        );
      });
    }
  });
});
