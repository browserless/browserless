/* eslint-disable no-unused-expressions */
import {
  BrowserManager,
  Config,
  FileSystem,
  Hooks,
} from '@browserless.io/browserless';
import * as fs from 'fs/promises';
import { expect } from 'chai';
import { tmpdir } from 'os';
import path from 'path';
import Sinon from 'sinon';

/**
 * Subclass that exposes `protected` cleanup internals so individual
 * invariants can be exercised without standing up a real Chrome
 * process. The behaviours under test are pure FS lifecycle — no
 * browser binary needed.
 */
class TestableBrowserManager extends BrowserManager {
  public testRemoveUserDataDir(dir: string | null) {
    return this.removeUserDataDir(dir);
  }
  public testSweepOrphanDataDirs() {
    return this.sweepOrphanDataDirs();
  }
  public testPeriodicSweep() {
    return this.periodicSweep();
  }
  public getPendingCleanup() {
    return this.pendingCleanup;
  }
  public getPeriodicSweepHandle() {
    return this.periodicSweepHandle;
  }
  public getInitCleanupPromise() {
    return this.initCleanupPromise;
  }
  public isShuttingDown() {
    return this.shuttingDown;
  }
  public getInstanceId() {
    return this.instanceId;
  }
  public registerSession(browser: object, session: object) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.browsers.set(browser as any, session as any);
  }
  public hasBrowser(browser: object) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.browsers.has(browser as any);
  }
  public browsersSize() {
    return this.browsers.size;
  }
}

const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false);

const cleanupTestDir = async (dir: string) => {
  await fs.rm(dir, { force: true, recursive: true }).catch(() => undefined);
};

/**
 * Per-test cleanup tracker. Every manager constructed inside a spec is
 * registered here so `afterEach` shuts it down (clearing the periodic-
 * sweep interval) and removes its data-dir, even when an assertion
 * throws mid-test. Without this, a failed assertion would leak the
 * interval (keeping mocha from exiting cleanly) and the temp dir
 * (cluttering /tmp across runs).
 */
const tracked: Array<{ manager: TestableBrowserManager; dataDir: string }> =
  [];
const trackedPaths: string[] = [];
const track = (manager: TestableBrowserManager, dataDir: string) => {
  tracked.push({ manager, dataDir });
};
const trackPath = (p: string) => {
  trackedPaths.push(p);
};
const drainTracked = async () => {
  while (tracked.length) {
    const { manager, dataDir } = tracked.pop()!;
    // shutdown() is idempotent (gated by `shuttingDown`), so re-running
    // on a manager whose test already shut it down is harmless.
    await manager.shutdown().catch(() => undefined);
    await cleanupTestDir(dataDir);
  }
  while (trackedPaths.length) {
    await cleanupTestDir(trackedPaths.pop()!);
  }
};

const makeManager = async () => {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
  const config = new Config();
  await config.setDataDir(dataDir);
  const fileSystem = Sinon.createStubInstance(FileSystem);
  const hooks = Sinon.createStubInstance(Hooks);
  const manager = new TestableBrowserManager(config, hooks, fileSystem);
  track(manager, dataDir);
  // Wait for the startup sweep to finish so per-test setup doesn't race
  // against it.
  await manager.getInitCleanupPromise();
  return { config, dataDir, fileSystem, hooks, manager };
};

interface MockBrowser {
  close: Sinon.SinonStub;
  isRunning: () => boolean;
  keepUntil: () => number;
  on: () => void;
  trackingId: undefined;
  wsEndpoint: () => null;
}

const makeMockBrowser = (
  closeBehavior: 'reject' | 'resolve' = 'resolve',
): MockBrowser => ({
  close:
    closeBehavior === 'resolve'
      ? Sinon.stub().resolves()
      : Sinon.stub().rejects(new Error('mock close error')),
  isRunning: () => false,
  keepUntil: () => 0,
  on: () => undefined,
  trackingId: undefined,
  wsEndpoint: () => null,
});

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'test-session',
  initialConnectURL: '/test',
  isTempDataDir: true,
  launchOptions: {},
  numbConnected: 0,
  resolver: () => undefined,
  routePath: '/test',
  startedOn: Date.now(),
  trackingId: undefined,
  ttl: 0,
  userDataDir: null,
  ...overrides,
});

describe(`BrowserManager — orphan data-dir cleanup`, () => {
  // Always-runs cleanup. Tests register managers via `track()` (or
  // implicitly via `makeManager()`); this hook shuts them down and
  // removes their temp dirs even if an assertion threw.
  afterEach(async () => {
    await drainTracked();
  });

  describe(`removeUserDataDir`, () => {
    it('removes an existing data-dir', async () => {
      const { dataDir, manager } = await makeManager();
      const target = path.join(dataDir, 'browserless-data-dir-r1');
      await fs.mkdir(target);

      await manager.testRemoveUserDataDir(target);

      expect(await pathExists(target)).to.be.false;
    });

    it('clears pendingCleanup entry when the path no longer exists', async () => {
      const { dataDir, manager } = await makeManager();
      const ghost = path.join(dataDir, 'ghost-' + Date.now());
      // Simulate a previous failed attempt that enqueued the path.
      manager.getPendingCleanup().add(ghost);

      await manager.testRemoveUserDataDir(ghost);

      expect(manager.getPendingCleanup().has(ghost)).to.be.false;
    });

    it('clears pendingCleanup entry on a successful retry', async () => {
      const { dataDir, manager } = await makeManager();
      const target = path.join(dataDir, 'browserless-data-dir-r2');
      await fs.mkdir(target);
      manager.getPendingCleanup().add(target);

      await manager.testRemoveUserDataDir(target);

      expect(manager.getPendingCleanup().has(target)).to.be.false;
      expect(await pathExists(target)).to.be.false;
    });
  });

  describe(`sweepOrphanDataDirs (startup sweep)`, () => {
    // Helper: backdate a directory's mtime so the staleness check treats
    // it as orphaned. 1 hour is well past the 30-minute ORPHAN_IDLE_MS
    // threshold and matches the "prior-run leftover" scenario this
    // sweep is designed to catch.
    const ageDir = (p: string) => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return fs.utimes(p, oneHourAgo, oneHourAgo);
    };

    it('removes stale orphan data-dirs from prior runs', async () => {
      const { dataDir, manager } = await makeManager();
      const instanceId = manager.getInstanceId();
      const orphan1 = path.join(
        dataDir,
        `browserless-data-dir-${instanceId}-old1`,
      );
      const orphan2 = path.join(
        dataDir,
        `browserless-data-dir-${instanceId}-old2`,
      );
      await fs.mkdir(orphan1);
      await fs.mkdir(orphan2);
      await ageDir(orphan1);
      await ageDir(orphan2);

      await manager.testSweepOrphanDataDirs();

      expect(await pathExists(orphan1)).to.be.false;
      expect(await pathExists(orphan2)).to.be.false;
    });

    it('removes stale orphan dirs whose name embeds a different instanceId (cross-restart cleanup)', async () => {
      // The dominant leak scenario: a previous run crashed without
      // graceful shutdown, leaving its data-dirs behind; this run has a
      // freshly-generated instanceId, so the sweep must NOT scope by
      // instance prefix or it would never reclaim those dirs.
      const { dataDir, manager } = await makeManager();
      const alienInstanceId = 'previous-run-instance-id';
      const orphan = path.join(
        dataDir,
        `browserless-data-dir-${alienInstanceId}-old`,
      );
      await fs.mkdir(orphan);
      await ageDir(orphan);

      await manager.testSweepOrphanDataDirs();

      expect(await pathExists(orphan)).to.be.false;
    });

    it('runs via the constructor-triggered initCleanup path', async () => {
      // Verifies the wiring from `constructor` → `initCleanup` →
      // `sweepOrphanDataDirs`, not just the direct method invocation
      // exercised by the other tests in this describe. Plant orphans
      // BEFORE constructing the manager; the constructor kicks off
      // initCleanup asynchronously, and we wait on the promise it
      // exposes to know the sweep has finished.
      const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
      trackPath(dataDir);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const orphan = path.join(dataDir, 'browserless-data-dir-prior-run');
      await fs.mkdir(orphan);
      await fs.utimes(orphan, oneHourAgo, oneHourAgo);

      const config = new Config();
      await config.setDataDir(dataDir);
      const manager = new TestableBrowserManager(
        config,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      track(manager, dataDir);

      // Do NOT pre-await via makeManager. The constructor already
      // kicked off initCleanup; awaiting the promise it exposes is the
      // only thing we should need.
      await manager.getInitCleanupPromise();

      expect(await pathExists(orphan)).to.be.false;
    });

    it('leaves fresh data-dirs untouched (treated as live, regardless of instanceId)', async () => {
      // A directory whose mtime is fresh is presumed to belong to a live
      // session — either ours (in flight) or another concurrently-running
      // BrowserManager process sharing this data-dir. Two managers
      // sharing one `config.getDataDir()` exercises the multi-process
      // case directly.
      const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
      trackPath(dataDir);

      const configA = new Config();
      await configA.setDataDir(dataDir);
      const managerA = new TestableBrowserManager(
        configA,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      track(managerA, dataDir);
      await managerA.getInitCleanupPromise();

      const configB = new Config();
      await configB.setDataDir(dataDir);
      const managerB = new TestableBrowserManager(
        configB,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      track(managerB, dataDir);
      await managerB.getInitCleanupPromise();

      // A "live" data-dir owned by manager B. mkdir leaves mtime at
      // `now`, so it falls inside the staleness window.
      const bDir = path.join(
        dataDir,
        `browserless-data-dir-${managerB.getInstanceId()}-live`,
      );
      await fs.mkdir(bDir);

      // Manager A re-runs its sweep (e.g. simulating a restart). It
      // must not delete manager B's fresh dir.
      await managerA.testSweepOrphanDataDirs();

      expect(await pathExists(bDir)).to.be.true;
    });

    it('leaves non-browserless entries in dataDir alone', async () => {
      const { dataDir, manager } = await makeManager();
      const instanceId = manager.getInstanceId();
      const friend = path.join(dataDir, 'unrelated-stuff');
      const ownOrphan = path.join(
        dataDir,
        `browserless-data-dir-${instanceId}-zzz`,
      );
      await fs.mkdir(friend);
      await fs.mkdir(ownOrphan);
      await ageDir(ownOrphan);
      // Plant a file that should also be untouched.
      await fs.writeFile(path.join(dataDir, 'a-marker.txt'), 'hi');
      await ageDir(friend);

      await manager.testSweepOrphanDataDirs();

      expect(await pathExists(friend)).to.be.true;
      expect(await pathExists(path.join(dataDir, 'a-marker.txt'))).to.be.true;
      expect(await pathExists(ownOrphan)).to.be.false;
    });
  });

  describe(`close()`, () => {
    it('evicts the session from the registry even when browser.close() rejects', async () => {
      const { manager } = await makeManager();
      const browser = makeMockBrowser('reject');
      const session = makeSession({
        isTempDataDir: false,
        userDataDir: '/some/external/path-not-managed-by-us',
      });
      manager.registerSession(browser, session);
      expect(manager.hasBrowser(browser)).to.be.true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await manager.close(browser as any, session as any, true);

      expect(manager.hasBrowser(browser)).to.be.false;
      expect(browser.close.calledOnce).to.be.true;
    });

    it('removes a temp data-dir even when browser.close() rejects', async () => {
      const { dataDir, manager } = await makeManager();
      const browser = makeMockBrowser('reject');
      const target = path.join(dataDir, 'browserless-data-dir-c1');
      await fs.mkdir(target);
      const session = makeSession({ isTempDataDir: true, userDataDir: target });
      manager.registerSession(browser, session);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await manager.close(browser as any, session as any, true);

      expect(await pathExists(target)).to.be.false;
      expect(manager.hasBrowser(browser)).to.be.false;
    });

    it('does NOT remove the data-dir when isTempDataDir is false', async () => {
      const { dataDir, manager } = await makeManager();
      const browser = makeMockBrowser('resolve');
      const external = path.join(dataDir, 'externally-owned');
      await fs.mkdir(external);
      const session = makeSession({
        isTempDataDir: false,
        userDataDir: external,
      });
      manager.registerSession(browser, session);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await manager.close(browser as any, session as any, true);

      expect(await pathExists(external)).to.be.true;
      expect(manager.hasBrowser(browser)).to.be.false;
    });
  });

  describe(`shutdown()`, () => {
    it('continues cleanup when one b.close() rejects (Promise.allSettled)', async () => {
      const { dataDir, manager } = await makeManager();
      const okBrowser = makeMockBrowser('resolve');
      const badBrowser = makeMockBrowser('reject');
      const okDir = path.join(dataDir, 'browserless-data-dir-ok');
      const badDir = path.join(dataDir, 'browserless-data-dir-bad');
      await fs.mkdir(okDir);
      await fs.mkdir(badDir);
      manager.registerSession(
        okBrowser,
        makeSession({ id: 'ok', isTempDataDir: true, userDataDir: okDir }),
      );
      manager.registerSession(
        badBrowser,
        makeSession({ id: 'bad', isTempDataDir: true, userDataDir: badDir }),
      );

      await manager.shutdown();

      expect(okBrowser.close.calledOnce).to.be.true;
      expect(badBrowser.close.calledOnce).to.be.true;
      expect(await pathExists(okDir)).to.be.false;
      expect(await pathExists(badDir)).to.be.false;
    });

    it('sets shuttingDown to true and clears periodicSweepHandle', async () => {
      const { manager } = await makeManager();
      expect(manager.isShuttingDown()).to.be.false;
      expect(manager.getPeriodicSweepHandle()).to.not.be.null;

      await manager.shutdown();

      expect(manager.isShuttingDown()).to.be.true;
      expect(manager.getPeriodicSweepHandle()).to.be.null;
    });

    it('does not arm periodicSweepHandle when shutdown is called during init', async () => {
      const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
      trackPath(dataDir);
      // A backlog of stale orphans makes the startup sweep slow enough
      // for the race to be observable: shutdown() runs while
      // initCleanup() is mid-walk. Backdate the mtime so the staleness
      // check actually queues each dir for deletion (otherwise the
      // sweep skips them and finishes instantly).
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      for (let i = 0; i < 50; i++) {
        const p = path.join(dataDir, `browserless-data-dir-init-${i}`);
        await fs.mkdir(p);
        await fs.utimes(p, oneHourAgo, oneHourAgo);
      }

      const config = new Config();
      await config.setDataDir(dataDir);
      const manager = new TestableBrowserManager(
        config,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      track(manager, dataDir);
      // Shut down without first awaiting initCleanupPromise. shutdown's
      // own await on the promise is what we're testing.
      await manager.shutdown();

      expect(manager.getPeriodicSweepHandle()).to.be.null;
    });
  });

  describe(`periodicSweep`, () => {
    it('drains pendingCleanup and removes paths that have reappeared as deletable', async () => {
      const { dataDir, manager } = await makeManager();
      const target = path.join(dataDir, 'browserless-data-dir-ps');
      await fs.mkdir(target);
      manager.getPendingCleanup().add(target);

      await manager.testPeriodicSweep();

      expect(await pathExists(target)).to.be.false;
      expect(manager.getPendingCleanup().has(target)).to.be.false;
    });

    it('drops pendingCleanup entries whose paths have vanished externally', async () => {
      const { dataDir, manager } = await makeManager();
      const ghost = path.join(dataDir, 'browserless-data-dir-ghost');
      // Never create the dir; it's "vanished" from the start.
      manager.getPendingCleanup().add(ghost);

      await manager.testPeriodicSweep();

      expect(manager.getPendingCleanup().has(ghost)).to.be.false;
    });

    // The host-wide chromium-internal sweep is gated by
    // `CLEANUP_HOST_CHROMIUM_TEMP_DIRS=true`. The pair of tests below
    // exercise both branches in the same process; the gate is read on
    // each tick (not at module load), so flipping the env var around
    // each test is sufficient — no module re-imports required. Each
    // test owns its own `org.chromium.Chromium.*` fixture in the OS
    // tmpdir (registered with `trackPath` so it gets cleaned up even
    // when the assertion that asserts it was *not* deleted fails).
    it('skips host-wide chromium-internal sweep when CLEANUP_HOST_CHROMIUM_TEMP_DIRS is unset', async () => {
      const prev = process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS;
      delete process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS;
      try {
        const { manager } = await makeManager();
        const cdir = await fs.mkdtemp(
          path.join(tmpdir(), 'org.chromium.Chromium.test-'),
        );
        trackPath(cdir);
        // Make it look long-stale so it would be a deletion candidate.
        const oldTime = new Date(Date.now() - 60 * 60 * 1000);
        await fs.utimes(cdir, oldTime, oldTime);

        await manager.testPeriodicSweep();

        // With Pass 2 gated off, the host-wide chromium dir must survive.
        expect(await pathExists(cdir)).to.be.true;
      } finally {
        if (prev === undefined) {
          delete process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS;
        } else {
          process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS = prev;
        }
      }
    });

    it('sweeps host-wide chromium-internal dirs when CLEANUP_HOST_CHROMIUM_TEMP_DIRS=true', async () => {
      const prev = process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS;
      process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS = 'true';
      try {
        const { manager } = await makeManager();
        const cdir = await fs.mkdtemp(
          path.join(tmpdir(), 'org.chromium.Chromium.test-'),
        );
        trackPath(cdir);
        // 1 hour idle is well past the 30-minute ORPHAN_IDLE_MS floor.
        const oldTime = new Date(Date.now() - 60 * 60 * 1000);
        await fs.utimes(cdir, oldTime, oldTime);

        await manager.testPeriodicSweep();

        expect(await pathExists(cdir)).to.be.false;
      } finally {
        if (prev === undefined) {
          delete process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS;
        } else {
          process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS = prev;
        }
      }
    });
  });
});
