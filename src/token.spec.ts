import {
  BrowserlessRoutes,
  Config,
  Forbidden,
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
import { ModuleKind, transpileModule } from 'typescript';
import { Token } from './token.js';
import debug from 'debug';
import { expect } from 'chai';
import { format } from 'util';
import getPort from 'get-port';
import { request as httpRequest } from 'http';
import { readFile } from 'fs/promises';
import { rejects } from 'assert/strict';

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

  const at = (path: string, value?: string) => {
    const req = request(value);
    req.parsed.pathname = path;
    return req;
  };
  const conditional = (strictAuthPolicy: boolean) =>
    ({
      name: 'ConditionalRoute',
      strictAuthPolicy,
      async auth(req: Request) {
        await Promise.resolve();
        return req.parsed.pathname === '/protected';
      },
    }) as unknown as HTTPRoute;

  it('lets a false policy result through and requires credentials otherwise', async () => {
    const route = conditional(false);
    for (const value of [undefined, 'wrong']) {
      expect(await token.isAuthorized(at('/protected', value), route)).to.equal(
        false,
      );
      expect(await token.isAuthorized(at('/public', value), route)).to.equal(
        true,
      );
    }
    for (const path of ['/protected', '/public']) {
      expect(
        await token.isAuthorized(at(path, 'first-test-token'), route),
      ).to.equal(true);
    }
  });

  it('requires credentials and an explicit true result with strictAuthPolicy', async () => {
    const route = conditional(true);
    for (const value of [undefined, 'wrong']) {
      for (const path of ['/protected', '/public']) {
        expect(await token.isAuthorized(at(path, value), route)).to.equal(
          false,
        );
      }
    }
    expect(
      await token.isAuthorized(at('/protected', 'first-test-token'), route),
    ).to.equal(true);
    await rejects(
      token.isAuthorized(at('/public', 'first-test-token'), route),
      Forbidden,
    );
  });

  for (const auth of [
    () => {
      throw new Error('policy failure');
    },
    async () => {
      throw new Error('policy failure');
    },
  ]) {
    it(`requires credentials when the policy ${auth.constructor.name === 'AsyncFunction' ? 'rejects' : 'throws'}`, async () => {
      const route = { auth, name: 'BrokenPolicyRoute' } as unknown as HTTPRoute;
      expect(await token.isAuthorized(request(), route)).to.equal(false);
      expect(
        await token.isAuthorized(request('first-test-token'), route),
      ).to.equal(true);
      route.strictAuthPolicy = true;
      await rejects(
        token.isAuthorized(request('first-test-token'), route),
        Forbidden,
      );
    });
  }

  it('preserves the route receiver for policy methods', async () => {
    const route = {
      name: 'PublicRoute',
      async auth(this: { name: string }) {
        if (this.name !== 'PublicRoute') throw new Error('lost route receiver');
        return false;
      },
    } as unknown as HTTPRoute;
    expect(await token.isAuthorized(request(), route)).to.equal(true);
  });

  it('warns without exposing policy error contents', async () => {
    const namespaces = debug.disable();
    debug.enable('browserless.io:token:*');
    const output: string[] = [];
    const log = Sinon.stub(debug, 'log').callsFake((...args) => {
      output.push(format(...args));
    });
    try {
      await rejects(
        token.isAuthorized(request('first-test-token'), {
          name: 'BrokenPolicy',
          strictAuthPolicy: true,
          auth: async () => {
            const error = new TypeError('synthetic-sensitive-value');
            error.name = 'synthetic-sensitive-type';
            throw error;
          },
        } as unknown as HTTPRoute),
        Forbidden,
      );
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

  it('requires credentials unless a policy returns exactly false', async () => {
    for (const result of [undefined, null, 0, '']) {
      const route = {
        name: 'IncompletePolicyRoute',
        auth: async () => result,
      } as unknown as HTTPRoute;
      expect(await token.isAuthorized(request(), route)).to.equal(false);
      expect(await token.isAuthorized(request('wrong'), route)).to.equal(false);
      expect(
        await token.isAuthorized(request('first-test-token'), route),
      ).to.equal(true);
      route.strictAuthPolicy = true;
      await rejects(
        token.isAuthorized(request('first-test-token'), route),
        Forbidden,
      );
    }
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

  it('retains protected strict-auth overrides for Token subclasses', async () => {
    class StrictToken extends Token {
      protected requiresStrictAuth(): boolean {
        return true;
      }
    }
    expect(
      await new StrictToken(config).isAuthorized(request('first-test-token'), {
        name: 'OverriddenStrictRoute',
        auth: async () => {
          throw new Error('strict routes must not run policies');
        },
      } as unknown as HTTPRoute),
    ).to.equal(true);
  });

  it('requires TOKEN in the documented MultiToken example even when EXTRA_TOKEN is set', async () => {
    const readme = await readFile(
      new URL('../bin/scaffold/README.md', import.meta.url),
      'utf8',
    );
    const source = readme
      .split('### Custom credentials')[1]
      .match(/```ts\n([\s\S]*?)\n```/)![1];
    const { outputText } = transpileModule(
      source.replace(
        '@browserless.io/browserless',
        new URL('./exports.js', import.meta.url).href,
      ),
      { compilerOptions: { module: ModuleKind.ESNext } },
    );
    const { default: MultiToken } = (await import(
      `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    )) as { default: typeof Token };
    const previous = process.env.EXTRA_TOKEN;
    process.env.EXTRA_TOKEN = 'extra-test-token';
    try {
      const config = new Config();
      config.setToken(null);
      expect(() => new MultiToken(config)).to.throw('requires TOKEN');
      config.setToken('first-test-token');
      const token = new MultiToken(config);
      const route = {
        name: 'ExampleRoute',
        auth: async () => true,
      } as unknown as HTTPRoute;
      expect(await token.isAuthorized(request(), route)).to.equal(false);
      expect(await token.isAuthorized(request('wrong'), route)).to.equal(false);
      expect(
        await token.isAuthorized(request('extra-test-token'), route),
      ).to.equal(true);
      expect(
        await token.isAuthorized(request('first-test-token'), route),
      ).to.equal(true);
    } finally {
      if (previous === undefined) delete process.env.EXTRA_TOKEN;
      else process.env.EXTRA_TOKEN = previous;
    }
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

    const status = (
      path: string,
      upgrade = false,
      extraHeaders: Record<string, string> = {},
    ) =>
      new Promise<number>((resolve, reject) => {
        httpRequest(
          {
            port,
            path,
            headers: {
              ...(upgrade
                ? { Connection: 'Upgrade', Upgrade: 'websocket' }
                : {}),
              ...extraHeaders,
            },
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
      it(`authorizes a valid query token even behind an unrelated pre-existing Authorization header on ${upgrade ? 'WebSocket' : 'HTTP'} routes (#5636)`, async () => {
        // moveTokenToHeader() only writes the Authorization header when none
        // already exists, so a proxy's own header must not shadow a valid
        // query token here.
        expect(
          await status('/protected?token=local-test-token', upgrade, {
            Authorization: 'Bearer unrelated-proxy-value',
          }),
        ).to.equal(200);
        expect(
          await status('/protected?token=wrong', upgrade, {
            Authorization: 'Bearer unrelated-proxy-value',
          }),
        ).to.equal(401);
        // A valid header still authorizes alongside a wrong query token.
        expect(
          await status('/protected?token=wrong', upgrade, {
            Authorization: 'Bearer local-test-token',
          }),
        ).to.equal(200);
      });
    }

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

      it(`accepts extra credentials through ${upgrade ? 'WebSocket' : 'HTTP'} Token wrappers`, async () => {
        class MultiToken extends Token {
          public async isTokenValid(req: Request): Promise<boolean> {
            return (
              getTokenFromRequest(req) === 'extra-test-token' ||
              super.isTokenValid(req)
            );
          }
          public async isAuthorized(req: Request, route: HTTPRoute) {
            const allowed = await super.isAuthorized(req, route);
            return allowed && req.queryParams?.allowed === true;
          }
        }
        route.querySchema = {
          type: 'object',
          properties: { allowed: { type: 'boolean' } },
          required: ['allowed'],
        };
        server['token'] = new MultiToken(config);
        expect(
          await status(
            '/protected?allowed=true&token=extra-test-token',
            upgrade,
          ),
        ).to.equal(200);
        expect(
          await status(
            '/protected?allowed=true&token=local-test-token',
            upgrade,
          ),
        ).to.equal(200);
        expect(
          await status(
            '/protected?allowed=false&token=extra-test-token',
            upgrade,
          ),
        ).to.equal(401);
        expect(metrics.get().unauthorized).to.equal(1);
        expect(
          await status('/protected?allowed=true&token=wrong', upgrade),
        ).to.equal(401);
        expect(metrics.get().unauthorized).to.equal(2);
      });

      it(`keeps ${upgrade ? 'WebSocket' : 'HTTP'} isAuthorized overrides that accept extra keys`, async () => {
        class LegacyMultiToken extends Token {
          public async isAuthorized(req: Request, route: HTTPRoute) {
            return (
              getTokenFromRequest(req) === 'extra-test-token' ||
              super.isAuthorized(req, route)
            );
          }
        }
        server['token'] = new LegacyMultiToken(config);
        for (const auth of [route.auth, true]) {
          route.auth = auth;
          expect(
            await status('/protected?token=extra-test-token', upgrade),
          ).to.equal(200);
          expect(await status('/protected?token=wrong', upgrade)).to.equal(401);
        }
      });

      it(`keeps the previous admission flow for replacement ${upgrade ? 'WebSocket' : 'HTTP'} Token services`, async () => {
        route.querySchema = {
          type: 'object',
          properties: { allowed: { type: 'boolean' } },
          required: ['allowed'],
        };
        const seen: unknown[] = [];
        server['token'] = {
          isAuthorized: async (req: Request) => {
            seen.push(req.queryParams?.allowed);
            return getTokenFromRequest(req) === 'extra-test-token';
          },
          // A partial Token API doesn't make the service a Token subclass.
          usesAuthPolicy: () => true,
        } as unknown as Token;
        // The replacement owns function policies: the server doesn't run them.
        expect(await status('/public?allowed=true', upgrade)).to.equal(401);
        expect(
          await status(
            '/protected?allowed=invalid&token=extra-test-token',
            upgrade,
          ),
        ).to.equal(400);
        expect(
          await status(
            '/protected?allowed=true&token=extra-test-token',
            upgrade,
          ),
        ).to.equal(200);
        // Called once per request, before validation coerces `allowed`.
        expect(seen).to.have.length(3);
        expect(seen).not.to.include(true);
      });

      it(`lets replacement services decide public non-strict ${upgrade ? 'WebSocket' : 'HTTP'} routes`, async () => {
        route.auth = false;
        const replacement = { isAuthorized: async () => false };
        server['token'] = replacement as unknown as Token;
        expect(await status('/public', upgrade)).to.equal(200);
        // Its own requiresAuth applies without the rest of Token's API.
        Object.assign(replacement, { requiresAuth: () => true });
        expect(await status('/public', upgrade)).to.equal(401);
        Object.assign(replacement, { requiresAuth: () => false });
        expect(await status('/public', upgrade)).to.equal(200);
        config.setStrictTokenUse(true);
        expect(await status('/public', upgrade)).to.equal(401);
      });

      it(`applies strict ${upgrade ? 'WebSocket' : 'HTTP'} policies to custom credential validation`, async () => {
        class MultiToken extends Token {
          public async isTokenValid(req: Request): Promise<boolean> {
            return getTokenFromRequest(req) === 'extra-test-token';
          }
        }
        route.strictAuthPolicy = true;
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
        for (const [strictAuthPolicy, expected] of [
          [false, [401, 200, 200, 200, 400, 400, 400]],
          [true, [401, 401, 200, 403, 401, 401, 400]],
        ] as const) {
          route.strictAuthPolicy = strictAuthPolicy;
          for (const [i, path] of [
            '/query?private=true',
            '/query?private=false',
            '/query?private=true&token=local-test-token',
            '/query?private=false&token=local-test-token',
            '/query?private=invalid',
            '/query?private=invalid&token=wrong',
            '/query?private=invalid&token=local-test-token',
          ].entries()) {
            expect(
              await status(path, upgrade),
              `${path} (strictAuthPolicy=${strictAuthPolicy})`,
            ).to.equal(expected[i]);
          }
        }
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
        expect(await status('/query?private=false', upgrade)).to.equal(200);
        expect(
          await status('/query?private=true&token=local-test-token', upgrade),
        ).to.equal(200);
      });
    }

    for (const [method, copy] of [
      ['POST', false],
      ['GET', false],
      ['POST', true],
    ] as const) {
      it(`supplies the validated ${method} body through a two-argument Token wrapper${copy ? ' from another package copy' : ''}`, async () => {
        class WrappedToken extends Token {
          public async isAuthorized(req: Request, route: HTTPRoute) {
            return super.isAuthorized(req, route);
          }
        }
        const wrapped = new WrappedToken(config);
        // A subclass of another package copy's Token fails instanceof here
        // but implements the same methods.
        server['token'] = copy
          ? ({
              requiresAuth: (r: HTTPRoute) => wrapped.requiresAuth(r),
              usesAuthPolicy: (r: HTTPRoute) => wrapped.usesAuthPolicy(r),
              isTokenValid: (req: Request) => wrapped.isTokenValid(req),
              isAuthorized: (req: Request, r: HTTPRoute) =>
                wrapped.isAuthorized(req, r),
            } as unknown as Token)
          : wrapped;
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
        for (const [strictAuthPolicy, expected] of [
          [false, [401, 200, 200, 200, 400, 400]],
          [true, [401, 200, 401, 403, 401, 400]],
        ] as const) {
          route.strictAuthPolicy = strictAuthPolicy;
          config.setStrictTokenUse(false);
          for (const [i, [value, token]] of [
            ['true'],
            ['true', 'local-test-token'],
            ['false'],
            ['false', 'local-test-token'],
            ['invalid'],
            ['invalid', 'local-test-token'],
          ].entries()) {
            const res = await send(value, token);
            expect(
              res.status,
              `${value} ${token} (strictAuthPolicy=${strictAuthPolicy})`,
            ).to.equal(expected[i]);
            if (res.status === 200) {
              expect(await res.json()).to.deep.equal({
                private: value === 'true',
              });
            }
          }
          config.setStrictTokenUse(true);
          expect((await send('invalid')).status).to.equal(401);
        }
      });
    }

    for (const [auth, strictAuthPolicy] of [
      [true, false],
      [async () => false, true],
    ] as const) {
      const label = strictAuthPolicy ? 'strictAuthPolicy' : 'static';
      it(`rejects ${label} token requirements before body parsing, validation or size checks`, async () => {
        route.auth = auth;
        route.strictAuthPolicy = strictAuthPolicy;
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

      it(`rejects missing or wrong credentials for ${label} token requirements without waiting for the HTTP body`, async () => {
        route.auth = auth;
        route.strictAuthPolicy = strictAuthPolicy;
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
    }

    // Statuses for no token, a wrong token and a valid token on each path.
    const policyOutcomes = {
      default: {
        protected: [401, 401, 200],
        public: [200, 200, 200],
        error: [401, 401, 200],
      },
      strictAuthPolicy: {
        protected: [401, 401, 200],
        public: [401, 401, 403],
        error: [401, 401, 403],
      },
      STRICT_TOKEN_USE: {
        protected: [401, 401, 200],
        public: [401, 401, 200],
        error: [401, 401, 200],
      },
    };
    for (const upgrade of [false, true]) {
      for (const [mode, outcomes] of Object.entries(policyOutcomes)) {
        it(`enforces callback policies on ${upgrade ? 'WebSocket upgrades' : 'HTTP requests'} (${mode})`, async () => {
          config.setStrictTokenUse(mode === 'STRICT_TOKEN_USE');
          route.strictAuthPolicy = mode === 'strictAuthPolicy';
          let unauthorized = 0;
          for (const [path, expected] of Object.entries(outcomes)) {
            for (const [i, token] of [
              '',
              'wrong',
              'local-test-token',
            ].entries()) {
              expect(
                await status(`/${path}?token=${token}`, upgrade),
                `/${path} with token "${token}"`,
              ).to.equal(expected[i]);
              if (expected[i] === 401) unauthorized++;
              // Only 401s count toward unauthorized metrics, not policy 403s.
              expect(metrics.get().unauthorized).to.equal(unauthorized);
            }
          }
        });
      }
    }
  });
});
