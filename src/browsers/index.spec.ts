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

const makeManager = async () => {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
  const config = new Config();
  await config.setDataDir(dataDir);
  const fileSystem = Sinon.createStubInstance(FileSystem);
  const hooks = Sinon.createStubInstance(Hooks);
  const manager = new TestableBrowserManager(config, hooks, fileSystem);
  // Wait for the startup sweep to finish so per-test setup doesn't race
  // against it.
  await manager.getInitCleanupPromise();
  return { config, dataDir, fileSystem, hooks, manager };
};

const cleanupTestDir = async (dir: string) => {
  await fs.rm(dir, { force: true, recursive: true }).catch(() => undefined);
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
  describe(`removeUserDataDir`, () => {
    it('removes an existing data-dir', async () => {
      const { dataDir, manager } = await makeManager();
      const target = path.join(dataDir, 'browserless-data-dir-r1');
      await fs.mkdir(target);

      await manager.testRemoveUserDataDir(target);

      expect(await pathExists(target)).to.be.false;
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });

    it('clears pendingCleanup entry when the path no longer exists', async () => {
      const { dataDir, manager } = await makeManager();
      const ghost = path.join(dataDir, 'ghost-' + Date.now());
      // Simulate a previous failed attempt that enqueued the path.
      manager.getPendingCleanup().add(ghost);

      await manager.testRemoveUserDataDir(ghost);

      expect(manager.getPendingCleanup().has(ghost)).to.be.false;
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });

    it('clears pendingCleanup entry on a successful retry', async () => {
      const { dataDir, manager } = await makeManager();
      const target = path.join(dataDir, 'browserless-data-dir-r2');
      await fs.mkdir(target);
      manager.getPendingCleanup().add(target);

      await manager.testRemoveUserDataDir(target);

      expect(manager.getPendingCleanup().has(target)).to.be.false;
      expect(await pathExists(target)).to.be.false;
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });
  });

  describe(`sweepOrphanDataDirs (startup sweep)`, () => {
    it('removes prior-run browserless-data-dir-* leftovers on construction', async () => {
      const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
      await fs.mkdir(path.join(dataDir, 'browserless-data-dir-old1'));
      await fs.mkdir(path.join(dataDir, 'browserless-data-dir-old2'));

      const config = new Config();
      await config.setDataDir(dataDir);
      const manager = new TestableBrowserManager(
        config,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      await manager.getInitCleanupPromise();

      const remaining = await fs.readdir(dataDir);
      expect(
        remaining.filter((e) => e.startsWith('browserless-data-dir-')),
      ).to.have.length(0);
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });

    it('leaves non-browserless entries in dataDir alone', async () => {
      const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
      const friend = path.join(dataDir, 'unrelated-stuff');
      const orphan = path.join(dataDir, 'browserless-data-dir-zzz');
      await fs.mkdir(friend);
      await fs.mkdir(orphan);
      // Plant a file that should also be untouched.
      await fs.writeFile(path.join(dataDir, 'a-marker.txt'), 'hi');

      const config = new Config();
      await config.setDataDir(dataDir);
      const manager = new TestableBrowserManager(
        config,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      await manager.getInitCleanupPromise();

      expect(await pathExists(friend)).to.be.true;
      expect(await pathExists(path.join(dataDir, 'a-marker.txt'))).to.be.true;
      expect(await pathExists(orphan)).to.be.false;
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });
  });

  describe(`close()`, () => {
    it('evicts the session from the registry even when browser.close() rejects', async () => {
      const { dataDir, manager } = await makeManager();
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
      await manager.shutdown();
      await cleanupTestDir(dataDir);
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
      await manager.shutdown();
      await cleanupTestDir(dataDir);
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
      await manager.shutdown();
      await cleanupTestDir(dataDir);
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
      await cleanupTestDir(dataDir);
    });

    it('sets shuttingDown to true and clears periodicSweepHandle', async () => {
      const { dataDir, manager } = await makeManager();
      expect(manager.isShuttingDown()).to.be.false;
      expect(manager.getPeriodicSweepHandle()).to.not.be.null;

      await manager.shutdown();

      expect(manager.isShuttingDown()).to.be.true;
      expect(manager.getPeriodicSweepHandle()).to.be.null;
      await cleanupTestDir(dataDir);
    });

    it('does not arm periodicSweepHandle when shutdown is called during init', async () => {
      const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'bless-bm-test-'));
      // A backlog of orphans makes the startup sweep slow enough for the
      // race to be observable: shutdown() runs while initCleanup() is
      // mid-walk.
      for (let i = 0; i < 50; i++) {
        await fs.mkdir(path.join(dataDir, `browserless-data-dir-init-${i}`));
      }

      const config = new Config();
      await config.setDataDir(dataDir);
      const manager = new TestableBrowserManager(
        config,
        Sinon.createStubInstance(Hooks),
        Sinon.createStubInstance(FileSystem),
      );
      // Shut down without first awaiting initCleanupPromise. shutdown's
      // own await on the promise is what we're testing.
      await manager.shutdown();

      expect(manager.getPeriodicSweepHandle()).to.be.null;
      await cleanupTestDir(dataDir);
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
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });

    it('drops pendingCleanup entries whose paths have vanished externally', async () => {
      const { dataDir, manager } = await makeManager();
      const ghost = path.join(dataDir, 'browserless-data-dir-ghost');
      // Never create the dir; it's "vanished" from the start.
      manager.getPendingCleanup().add(ghost);

      await manager.testPeriodicSweep();

      expect(manager.getPendingCleanup().has(ghost)).to.be.false;
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });

    it('skips host-wide chromium-internal sweep by default (CLEANUP_HOST_CHROMIUM_TEMP_DIRS unset)', async () => {
      // The env-var read is at module-load time, and the test process
      // does not set it — so this test exercises the default-safe path.
      const { dataDir, manager } = await makeManager();
      const cdir = await fs.mkdtemp(
        path.join(tmpdir(), 'org.chromium.Chromium.test-'),
      );
      // Make it look long-stale so it would be a deletion candidate.
      const oldTime = new Date(Date.now() - 60 * 60 * 1000);
      await fs.utimes(cdir, oldTime, oldTime);

      await manager.testPeriodicSweep();

      // With Pass 2 gated off, the host-wide chromium dir must survive.
      expect(await pathExists(cdir)).to.be.true;
      await fs.rm(cdir, { force: true, recursive: true });
      await manager.shutdown();
      await cleanupTestDir(dataDir);
    });
  });
});
