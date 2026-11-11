import {
  BrowserlessRoutes,
  Config,
  HTTPRoute,
  HTTPServer,
  Hooks,
  Logger,
  Metrics,
  Request,
  Router,
  WebSocketRoute,
  contentTypes,
  getTokenFromRequest,
  writeResponse,
} from '@browserless.io/browserless';
import Sinon from 'sinon';
import { Token } from './token.js';
import debug from 'debug';
import { expect } from 'chai';
import { format } from 'util';
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

  it('requires configured credentials even when a policy returns false', async () => {
    const route = {
      name: 'ConditionalRoute',
      async auth(req: Request) {
        await Promise.resolve();
        return req.parsed.pathname === '/protected';
      },
    } as unknown as HTTPRoute;
    const req = request();
    req.parsed.pathname = '/protected';
    expect(await token.isAuthorized(req, route, 'policy')).to.equal(false);
    req.parsed.searchParams.set('token', 'wrong');
    expect(await token.isAuthorized(req, route, 'policy')).to.equal(false);
    req.parsed.searchParams.set('token', 'first-test-token');
    expect(await token.isAuthorized(req, route, 'policy')).to.equal(true);
    expect(await token.isAuthorized(request(), route, 'policy')).to.equal(
      false,
    );
    expect(
      await token.isAuthorized(request('wrong'), route, 'policy'),
    ).to.equal(false);
    expect(
      await token.isAuthorized(request('first-test-token'), route, 'policy'),
    ).to.equal(false);
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
        await token.isAuthorized(
          request('first-test-token'),
          {
            auth,
            name: 'BrokenPolicyRoute',
          } as unknown as HTTPRoute,
          'policy',
        ),
      ).to.equal(false);
    });
  }

  it('preserves the route receiver for policy methods', async () => {
    const route = {
      name: 'ProtectedRoute',
      async auth(this: { name: string }) {
        if (this.name !== 'ProtectedRoute')
          throw new Error('lost route receiver');
        return true;
      },
    } as unknown as HTTPRoute;
    expect(
      await token.isAuthorized(request('first-test-token'), route, 'policy'),
    ).to.equal(true);
  });

  it('warns without exposing policy error contents', async () => {
    const namespaces = debug.disable();
    debug.enable('browserless.io:token:*');
    const output: string[] = [];
    const log = Sinon.stub(debug, 'log').callsFake((...args) => {
      output.push(format(...args));
    });
    try {
      expect(
        await token.isAuthorized(
          request('first-test-token'),
          {
            name: 'BrokenPolicy',
            auth: async () => {
              const error = new TypeError('synthetic-sensitive-value');
              error.name = 'synthetic-sensitive-type';
              throw error;
            },
          } as unknown as HTTPRoute,
          'policy',
        ),
      ).to.equal(false);
      expect(output.join('\n')).to.include(
        'Route authentication policy failed',
      );
      expect(output.join('\n')).to.include('BrokenPolicy');
      expect(output.join('\n')).to.include('token:debug');
      expect(output.join('\n')).to.include('TypeError');
      expect(output.join('\n')).to.include('policy pass');
      expect(output.join('\n')).not.to.include('synthetic-sensitive-value');
      expect(output.join('\n')).not.to.include('synthetic-sensitive-type');
    } finally {
      log.restore();
      debug.enable(namespaces);
    }
  });

  it('denies incomplete policies even with valid credentials', async () => {
    for (const result of [undefined, null, 0, '']) {
      const route = {
        name: 'IncompletePolicyRoute',
        auth: async () => result,
      } as unknown as HTTPRoute;
      expect(await token.isAuthorized(request(), route, 'policy')).to.equal(
        false,
      );
      expect(
        await token.isAuthorized(request('wrong'), route, 'policy'),
      ).to.equal(false);
      expect(
        await token.isAuthorized(request('first-test-token'), route, 'policy'),
      ).to.equal(false);
    }
  });

  it('leaves policies inert when no token is configured', async () => {
    const config = new Config();
    config.setToken(null);
    expect(
      await new Token(config).isAuthorized(
        request(),
        {
          name: 'NoTokenRoute',
          auth: async () => {
            throw new Error('policy must not run');
          },
        } as unknown as HTTPRoute,
        'policy',
      ),
    ).to.equal(true);
  });

  it('retains protected strict-auth overrides for Token subclasses', async () => {
    class StrictToken extends Token {
      protected requiresStrictAuth(): boolean {
        return true;
      }
    }
    expect(
      await new StrictToken(config).isAuthorized(
        request('first-test-token'),
        {
          name: 'OverriddenStrictRoute',
          auth: async () => {
            throw new Error('strict routes must not run policies');
          },
        } as unknown as HTTPRoute,
        'policy',
      ),
    ).to.equal(true);
  });

  describe('HTTP and WebSocket admission', () => {
    let server: HTTPServer;
    let port: number;
    let config: Config;
    let route: HTTPRoute;
    let metrics: Metrics;

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
      metrics = new Metrics();
      server = new HTTPServer(
        config,
        metrics,
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
      it(`honors Token strict-auth overrides on public ${upgrade ? 'WebSocket' : 'HTTP'} routes`, async () => {
        class StrictToken extends Token {
          protected requiresStrictAuth(): boolean {
            return true;
          }
        }
        route.auth = false;
        server['token'] = new StrictToken(config);
        expect(await status('/public', upgrade)).to.equal(401);
        expect(await status('/public?token=wrong', upgrade)).to.equal(401);
        expect(
          await status('/public?token=local-test-token', upgrade),
        ).to.equal(200);
      });

      it(`does not revalidate one-use credentials in strict ${upgrade ? 'WebSocket' : 'HTTP'} admission`, async () => {
        class OneUseToken extends Token {
          private used = false;
          protected async isTokenValid(req: Request): Promise<boolean> {
            if (this.used) return false;
            this.used = true;
            return super.isTokenValid(req);
          }
        }
        config.setStrictTokenUse(true);
        server['token'] = new OneUseToken(config);
        expect(await status('/error?token=local-test-token', upgrade)).to.equal(
          200,
        );
      });

      it(`does not call an SDK server's unrelated isAuthorized method for ${upgrade ? 'WebSocket' : 'HTTP'} admission`, async () => {
        Object.assign(server, { isAuthorized: async () => false });
        expect(
          await status('/protected?token=local-test-token', upgrade),
        ).to.equal(200);
      });

      it(`keeps public ${upgrade ? 'WebSocket' : 'HTTP'} routes usable without a Token service`, async () => {
        route.auth = false;
        server['token'] = null as unknown as Token;
        expect(await status('/public', upgrade)).to.equal(200);
      });

      it(`leaves ${upgrade ? 'WebSocket' : 'HTTP'} policies inert without a configured token`, async () => {
        config.setToken(null);
        expect(await status('/error', upgrade)).to.equal(200);
      });

      it(`accepts extra credentials from legacy ${upgrade ? 'WebSocket' : 'HTTP'} Token overrides`, async () => {
        class MultiToken extends Token {
          public async isAuthorized(req: Request, route: HTTPRoute) {
            return (
              getTokenFromRequest(req) === 'extra-test-token' ||
              super.isAuthorized(req, route)
            );
          }
        }
        server['token'] = new MultiToken(config);
        expect(
          await status('/protected?token=extra-test-token', upgrade),
        ).to.equal(200);
        expect(
          await status('/public?token=extra-test-token', upgrade),
        ).to.equal(403);
        expect(
          await status('/protected?token=local-test-token', upgrade),
        ).to.equal(200);
        expect(await status('/protected?token=wrong', upgrade)).to.equal(401);
      });

      it(`supports replacement ${upgrade ? 'WebSocket' : 'HTTP'} Token services with only isAuthorized`, async () => {
        route.auth = true;
        server['token'] = {
          isAuthorized: async (req: Request) => {
            if (getTokenFromRequest(req) === 'extra-test-token') return true;
            return undefined;
          },
        } as unknown as Token;
        expect(
          await status('/protected?token=extra-test-token', upgrade),
        ).to.equal(200);
        expect(await status('/protected?token=wrong', upgrade)).to.equal(401);
      });

      it(`applies ${upgrade ? 'WebSocket' : 'HTTP'} policies to custom credential validation`, async () => {
        class MultiToken extends Token {
          protected async isTokenValid(req: Request): Promise<boolean> {
            return getTokenFromRequest(req) === 'extra-test-token';
          }
        }
        server['token'] = new MultiToken(config);
        expect(
          await status('/protected?token=extra-test-token', upgrade),
        ).to.equal(200);
        expect(
          await status('/public?token=extra-test-token', upgrade),
        ).to.equal(403);
        expect(await status('/error?token=extra-test-token', upgrade)).to.equal(
          403,
        );
        expect(
          await status('/protected?token=local-test-token', upgrade),
        ).to.equal(401);
        expect(await status('/protected', upgrade)).to.equal(401);
      });

      it(`supplies validated query parameters to ${upgrade ? 'WebSocket' : 'HTTP'} policies`, async () => {
        route.querySchema = {
          type: 'object',
          properties: { private: { type: 'boolean' } },
          required: ['private'],
        };
        route.auth = async (req) => {
          return req.queryParams?.private === true;
        };
        expect(await status('/query?private=true', upgrade)).to.equal(401);
        expect(await status('/query?private=false', upgrade)).to.equal(401);
        expect(
          await status('/query?private=true&token=local-test-token', upgrade),
        ).to.equal(200);
        expect(
          await status('/query?private=false&token=local-test-token', upgrade),
        ).to.equal(403);
        expect(await status('/query?private=invalid', upgrade)).to.equal(401);
        expect(
          await status('/query?private=invalid&token=wrong', upgrade),
        ).to.equal(401);
        expect(
          await status(
            '/query?private=invalid&token=local-test-token',
            upgrade,
          ),
        ).to.equal(400);
      });

      it(`defers policies on strict-exempt ${upgrade ? 'WebSocket' : 'HTTP'} routes`, async () => {
        config.setStrictTokenUse(true);
        route.name = BrowserlessRoutes.StaticGetRoute;
        route.querySchema = {
          type: 'object',
          properties: { private: { type: 'boolean' } },
          required: ['private'],
        };
        route.auth = async (req) => {
          if (typeof req.queryParams?.private !== 'boolean')
            throw new Error('policy needs validated query');
          return req.queryParams.private;
        };
        expect(await status('/query?private=true', upgrade)).to.equal(401);
        expect(await status('/query?private=false', upgrade)).to.equal(401);
        expect(
          await status('/query?private=true&token=local-test-token', upgrade),
        ).to.equal(200);
      });
    }

    for (const method of ['POST', 'GET']) {
      it(`supplies the validated ${method} body through a two-argument Token wrapper`, async () => {
        class WrappedToken extends Token {
          public async isAuthorized(req: Request, route: HTTPRoute) {
            return super.isAuthorized(req, route);
          }
        }
        server['token'] = new WrappedToken(config);
        config.enableGETRequests(true);
        route.bodySchema = {
          type: 'object',
          properties: { private: { type: 'boolean' } },
          required: ['private'],
        };
        route.auth = async (req) => {
          const body = req.body as { private?: boolean };
          if (typeof body?.private !== 'boolean')
            throw new Error('policy needs validated body');
          return body.private;
        };
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
        expect((await send('false')).status).to.equal(401);
        const falsePolicyResponse = await send('false', 'local-test-token');
        expect(falsePolicyResponse.status).to.equal(403);
        expect((await send('invalid')).status).to.equal(401);
        expect((await send('invalid', 'local-test-token')).status).to.equal(
          400,
        );
        config.setStrictTokenUse(true);
        expect((await send('invalid')).status).to.equal(401);
      });
    }

    for (const auth of [true, async () => false]) {
      it(`rejects ${typeof auth === 'function' ? 'function' : 'static'} token requirements before body parsing, validation or size checks`, async () => {
        route.auth = auth;
        route.accepts = [contentTypes.json];
        route.bodySchema = {
          type: 'object',
          properties: { private: { type: 'boolean' } },
          required: ['private'],
        };
        config.setMaxPayloadSize(64);
        for (const [body, expected] of [
          ['{', 400],
          ['{}', 400],
          [JSON.stringify({ private: true, padding: 'x'.repeat(100) }), 400],
        ] as const) {
          for (const token of ['', 'wrong', 'local-test-token']) {
            const res = await fetch(
              `http://localhost:${port}/body?token=${token}`,
              {
                method: 'POST',
                headers: { 'content-type': contentTypes.json },
                body,
              },
            );
            expect(res.status).to.equal(
              token === 'local-test-token' ? expected : 401,
            );
            if (res.status === 401) {
              expect(await res.text()).not.to.include('private');
            } else if (body.length > 64) {
              expect(await res.text()).to.include(
                'exceeds maximum allowed size',
              );
            }
          }
        }
      });
    }

    it('rejects missing or wrong credentials without waiting for the HTTP body', async () => {
      for (const token of ['', 'wrong']) {
        const code = await new Promise<number>((resolve, reject) => {
          const req = httpRequest(
            {
              port,
              path: `/body?token=${token}`,
              method: 'POST',
              headers: { 'content-length': '1024' },
            },
            (res) => {
              res.resume();
              res.on('end', () => {
                resolve(res.statusCode!);
                req.destroy();
              });
            },
          );
          req.on('error', reject);
          req.setTimeout(1000, () =>
            req.destroy(new Error('auth waited for body')),
          );
          req.flushHeaders();
        });
        expect(code).to.equal(401);
      }
    });

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
        expect(metrics.get().unauthorized).to.equal(2);
        expect(await status('/public', upgrade)).to.equal(401);
        expect(await status('/public?token=wrong', upgrade)).to.equal(401);
        expect(metrics.get().unauthorized).to.equal(4);
        expect(
          await status('/public?token=local-test-token', upgrade),
        ).to.equal(strict ? 200 : 403);
        expect(metrics.get().unauthorized).to.equal(4);
        expect(await status('/error?token=local-test-token', upgrade)).to.equal(
          strict ? 200 : 403,
        );
        expect(metrics.get().unauthorized).to.equal(4);
      });
    }
  });
});
