import {
  Browserless,
  BrowserlessRoutes,
  Config,
  HTTPRoute,
  Metrics,
  Request,
  Token,
} from '@browserless.io/browserless';
import { execFile } from 'child_process';
import { expect } from 'chai';
import { fileURLToPath } from 'url';
import getPort from 'get-port';

const withEnv = (value: string | undefined, fn: () => void) => {
  const prior = process.env.STRICT_TOKEN_USE;
  if (value === undefined) delete process.env.STRICT_TOKEN_USE;
  else process.env.STRICT_TOKEN_USE = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env.STRICT_TOKEN_USE;
    else process.env.STRICT_TOKEN_USE = prior;
  }
};

const request = (token?: string) =>
  ({
    headers: {},
    parsed: new URL(
      `http://localhost/json/version${token ? `?token=${token}` : ''}`,
    ),
  }) as unknown as Request;

const route = (auth: HTTPRoute['auth'], name = 'SomeRoute') =>
  ({ auth, name }) as unknown as HTTPRoute;

describe('STRICT_TOKEN_USE', () => {
  describe('Config', () => {
    it('defaults to false', () => {
      withEnv(undefined, () =>
        expect(new Config().getStrictTokenUse()).to.equal(false),
      );
    });

    it('reads "true" and "false"', () => {
      withEnv('true', () =>
        expect(new Config().getStrictTokenUse()).to.equal(true),
      );
      withEnv('false', () =>
        expect(new Config().getStrictTokenUse()).to.equal(false),
      );
    });
  });

  describe('Token#isAuthorized', () => {
    const tokenFor = (strict: boolean) => {
      const config = new Config();
      config.setToken('browserless');
      config.setStrictTokenUse(strict);
      return new Token(config);
    };

    it('lets auth = false routes through when off', async () => {
      expect(await tokenFor(false).isAuthorized(request(), route(false))).to.be
        .true;
    });

    it('requires the token on auth = false routes when on', async () => {
      const token = tokenFor(true);
      expect(await token.isAuthorized(request(), route(false))).to.be.false;
      expect(await token.isAuthorized(request('nope'), route(false))).to.be
        .false;
      expect(await token.isAuthorized(request('browserless'), route(false))).to
        .be.true;
    });

    it('overrides function-valued auth when on', async () => {
      const token = tokenFor(true);
      const custom = route(async () => true);
      expect(await token.isAuthorized(request(), custom)).to.be.false;
      expect(await token.isAuthorized(request('browserless'), custom)).to.be
        .true;
    });

    it('keeps static files public when on', async () => {
      expect(
        await tokenFor(true).isAuthorized(
          request(),
          route(false, BrowserlessRoutes.StaticGetRoute),
        ),
      ).to.be.true;
    });

    it('is inert without a configured TOKEN', async () => {
      const config = new Config();
      config.setToken(null);
      config.setStrictTokenUse(true);
      expect(await new Token(config).isAuthorized(request(), route(true))).to.be
        .true;
    });
  });

  describe('Browserless#start', () => {
    const fixtureRoute = fileURLToPath(
      new URL('./strict-token.fixture.js', import.meta.url),
    );

    let browserless: Browserless | undefined;

    afterEach(async () => {
      await browserless?.stop();
      browserless = undefined;
    });

    for (const [label, token] of [
      ['without a TOKEN', null],
      ['with an empty TOKEN', ''],
    ] as const) {
      it(`refuses to start when on ${label}`, async () => {
        const config = new Config();
        config.setToken(token);
        config.setStrictTokenUse(true);
        config.setPort(await getPort());
        browserless = new Browserless({ config, metrics: new Metrics() });

        const startError = await browserless.start().then(
          () => null,
          (err: Error) => err,
        );
        expect(startError?.message, 'expected start() to reject').to.include(
          'STRICT_TOKEN_USE',
        );
        const res = await fetch(
          `http://localhost:${config.getPort()}/json/version`,
        ).catch(() => null);
        expect(res, 'expected no server to be listening').to.equal(null);
      });
    }

    it('serves static files tokenless and gates the rest when on', async () => {
      const config = new Config();
      config.setToken('browserless');
      config.setStrictTokenUse(true);
      config.setPort(await getPort());
      browserless = new Browserless({ config, metrics: new Metrics() });
      await browserless.start();
      const base = `http://localhost:${config.getPort()}`;

      expect((await fetch(`${base}/favicon-32x32.png`)).status).to.equal(200);
      expect((await fetch(`${base}/pressure`)).status).to.equal(401);
      expect(
        (await fetch(`${base}/pressure?token=browserless`)).status,
      ).to.equal(200);
    });

    it('gates auth = false HTTP routes only when on', async () => {
      for (const strict of [false, true]) {
        const config = new Config();
        config.setToken('browserless');
        config.setStrictTokenUse(strict);
        config.setPort(await getPort());
        browserless = new Browserless({ config, metrics: new Metrics() });
        browserless.addHTTPRoute(fixtureRoute);
        await browserless.start();
        const url = `http://localhost:${config.getPort()}/strict-token-fixture`;

        expect((await fetch(url)).status).to.equal(strict ? 401 : 200);
        expect((await fetch(`${url}?token=browserless`)).status).to.equal(200);
        await browserless.stop();
        browserless = undefined;
      }
    });
  });

  describe('entrypoint', () => {
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          [fileURLToPath(new URL('./index.js', import.meta.url))],
          { env: { ...process.env, TOKEN: '', ...env }, timeout: 30000 },
          (_err, _stdout, stderr) => resolve({ code: child.exitCode, stderr }),
        );
      });

    it('exits 1 with a message when on without a TOKEN', async () => {
      const { code, stderr } = await run({
        DEBUG: '-*',
        PORT: String(await getPort()),
        STRICT_TOKEN_USE: 'true',
      });
      expect(code).to.equal(1);
      expect(stderr).to.include('STRICT_TOKEN_USE');
    });
  });
});
