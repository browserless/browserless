import {
  BrowserInstance,
  BrowserManager,
  BrowserlessSession,
  Config,
  FileSystem,
  Hooks,
} from '@browserless.io/browserless';
import { expect } from 'chai';

// A plain object, not a real browser class instance, is deliberately NOT
// `instanceof` any class in `chromeBrowsers` — the CDP page-enumeration
// branch in generateSessionJson is exercised separately, via the subclass
// below overriding browserIsChrome/fetchBrowserJSON instead of needing a
// real browser or network call.
const makeFakeBrowser = (pid: number | null) =>
  ({
    constructor: { name: 'FakeBrowser' },
    isRunning: () => true,
    keepUntil: () => 0,
    process: () => (pid === null ? null : { pid }),
    wsEndpoint: () => null,
  }) as unknown as BrowserInstance;

const makeSession = (id: string): BrowserlessSession => ({
  id,
  initialConnectURL: 'http://localhost/',
  isTempDataDir: true,
  launchOptions: {},
  numbConnected: 1,
  resolver: () => undefined,
  routePath: '/',
  scratchDir: null,
  startedOn: Date.now(),
  ttl: 0,
  userDataDir: null,
});

// Exposes the protected methods under test and lets each test swap in a
// canned process tree instead of calling the real `si.processes()`.
class TestBrowserManager extends BrowserManager {
  public fakeTree: ReturnType<BrowserManager['getProcessTree']> | null = null;
  public fakeChromePages: Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }> | null = null;

  protected override async getProcessTree() {
    return this.fakeTree ? await this.fakeTree : null;
  }

  protected override browserIsChrome() {
    return this.fakeChromePages !== null;
  }

  protected override async fetchBrowserJSON<T>(): Promise<T | null> {
    return this.fakeChromePages as unknown as T;
  }

  // Defaults to 1 core so tree-summing tests aren't coupled to the
  // core-count scaling, which has its own dedicated test below.
  public async callGenerateSessionJson(
    browser: BrowserInstance,
    session: BrowserlessSession,
    numCores = 1,
  ) {
    const processTree = await this.getProcessTree();
    return (
      this as unknown as {
        generateSessionJson: (
          b: BrowserInstance,
          s: BrowserlessSession,
          t: unknown,
          n: number,
        ) => Promise<unknown[]>;
      }
    ).generateSessionJson(browser, session, processTree, numCores);
  }
}

const makeManager = () =>
  new TestBrowserManager(
    new Config(),
    new Hooks(),
    new FileSystem(new Config()),
  );

describe('BrowserManager session stats (#5615)', () => {
  it('sums cpu and memory across a process and its descendants', async () => {
    const manager = makeManager();
    manager.fakeTree = Promise.resolve({
      byPid: new Map([
        [100, { cpu: 10, memRss: 1000, parentPid: 1, pid: 100 }],
        [101, { cpu: 5, memRss: 500, parentPid: 100, pid: 101 }],
        [102, { cpu: 2, memRss: 200, parentPid: 101, pid: 102 }],
        // A sibling of pid 100, not a descendant — must not be counted.
        [200, { cpu: 99, memRss: 99999, parentPid: 1, pid: 200 }],
      ]),
      childrenByParentPid: new Map([
        [1, [100, 200]],
        [100, [101]],
        [101, [102]],
      ]),
    } as never);

    const [session] = (await manager.callGenerateSessionJson(
      makeFakeBrowser(100),
      makeSession('a'),
    )) as Array<{ cpu: number; memoryBytes: number; type: string }>;

    expect(session.type).to.equal('browser');
    // 10 + 5 + 2, not the sibling's 99.
    expect(session.cpu).to.equal(17);
    // (1000 + 500 + 200) KB, normalized to bytes.
    expect(session.memoryBytes).to.equal(1700 * 1024);
  });

  it('reports null when the session has no process', async () => {
    const manager = makeManager();
    manager.fakeTree = Promise.resolve({
      byPid: new Map(),
      childrenByParentPid: new Map(),
    } as never);

    const [session] = (await manager.callGenerateSessionJson(
      makeFakeBrowser(null),
      makeSession('b'),
    )) as Array<{ cpu: number | null; memoryBytes: number | null }>;

    expect(session.cpu).to.be.null;
    expect(session.memoryBytes).to.be.null;
  });

  it('reports null, not a crash, when the process list could not be read', async () => {
    const manager = makeManager();
    manager.fakeTree = Promise.resolve(null) as never;

    const [session] = (await manager.callGenerateSessionJson(
      makeFakeBrowser(100),
      makeSession('c'),
    )) as Array<{ cpu: number | null; memoryBytes: number | null }>;

    expect(session.cpu).to.be.null;
    expect(session.memoryBytes).to.be.null;
  });

  it("scales cpu by core count to match ps's per-core convention", async () => {
    const manager = makeManager();
    manager.fakeTree = Promise.resolve({
      byPid: new Map([
        // systeminformation reports this as a share of all cores combined
        // (25 = one full core saturated on a 4-core host), not ps's
        // per-core convention (where one full core reads ~100).
        [100, { cpu: 25, memRss: 1000, parentPid: 1, pid: 100 }],
      ]),
      childrenByParentPid: new Map(),
    } as never);

    const [session] = (await manager.callGenerateSessionJson(
      makeFakeBrowser(100),
      makeSession('e'),
      4,
    )) as Array<{ cpu: number }>;

    expect(session.cpu).to.equal(100);
  });

  it('does not duplicate the browser-level numbers onto page entries', async () => {
    const manager = makeManager();
    manager.fakeTree = Promise.resolve({
      byPid: new Map([
        [100, { cpu: 40, memRss: 4096, parentPid: 1, pid: 100 }],
      ]),
      childrenByParentPid: new Map(),
    } as never);
    manager.fakeChromePages = [
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/abc',
      },
    ];

    const browser = makeFakeBrowser(100);
    (browser as unknown as { wsEndpoint: () => string }).wsEndpoint = () =>
      'ws://127.0.0.1:1/devtools/browser/root';

    const results = (await manager.callGenerateSessionJson(
      browser,
      makeSession('d'),
    )) as Array<{ cpu: unknown; memoryBytes: unknown; type: string }>;

    const [browserEntry, pageEntry] = results;
    expect(browserEntry.type).to.equal('browser');
    expect(browserEntry.cpu).to.equal(40);

    expect(pageEntry.type).to.equal('page');
    // A per-page reading isn't tracked — the field must be absent, not a
    // copy of the browser-level number, so JSON output doesn't look like
    // each page has its own separate (and wrong) measurement.
    expect(pageEntry.cpu).to.be.undefined;
    expect(pageEntry.memoryBytes).to.be.undefined;
  });
});
