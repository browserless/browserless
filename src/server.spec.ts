import { EventEmitter } from 'events';
import {
  Config,
  HTTPServer,
  Hooks,
  Logger,
  Metrics,
  Request,
  Token,
} from '@browserless.io/browserless';
import { expect } from 'chai';

class TestServer extends HTTPServer {
  public unsafe(req: Request, res: unknown) {
    return this.handleRequestUnsafe(req, res as never);
  }
}

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

const makeReq = (target: string): Request =>
  ({
    headers: {},
    method: 'PUT',
    url: target,
  }) as unknown as Request;

const runThroughHook = async (original: string, rewrite?: string) => {
  const config = new Config();
  const server = new TestServer(
    config,
    new Metrics(),
    new Token(config),
    null as never,
    new Hooks(),
    Logger,
  );
  const req = makeReq(original);
  (server as unknown as { hooks: unknown }).hooks = {
    before: async ({ req: r }: { req: Request }) => {
      if (rewrite !== undefined) {
        (r as unknown as { url: string }).url = rewrite;
      }
      return true;
    },
  };
  // No routes are configured: everything past the rawUrl bookkeeping is
  // expected to bail out (thrown or 404), which is fine for this test.
  await server.unsafe(req, makeRes()).catch(() => undefined);
  return req.rawUrl;
};

describe('hook-rewritten request targets keep rawUrl consistent', () => {
  it('adopts the hook target when the hook sets its own query', async () => {
    const rawUrl = await runThroughHook(
      '/json/new?http://one.com',
      '/json/new?http://two.com?x=1',
    );
    expect(rawUrl).to.equal('/json/new?http://two.com?x=1');
  });

  it('carries the original raw query when the hook changes only the target', async () => {
    const rawUrl = await runThroughHook(
      '/json/new?http://one.com',
      '/json/new',
    );
    expect(rawUrl).to.equal('/json/new?http://one.com');
  });

  it('leaves rawUrl untouched when the hook does not rewrite the target', async () => {
    const rawUrl = await runThroughHook('/json/new?http://one.com', undefined);
    expect(rawUrl).to.equal('/json/new?http://one.com');
  });
});
