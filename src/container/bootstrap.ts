import {
  Config,
  FileSystem,
  Hooks,
  Limiter,
  Logger,
  Metrics,
  Monitoring,
  Router,
  SessionReplay,
  Token,
  WebHooks,
} from '@browserless.io/browserless';

import { ServiceContainer } from './container.js';
import { BrowserManager } from '../browsers/index.js';
import type { IReplayStore } from '../interfaces/replay-store.interface.js';
import { SessionRegistry } from '../session/session-registry.js';
import { ReplayCoordinator } from '../session/replay-coordinator.js';

/**
 * Service names for type-safe resolution.
 */
export const Services = {
  Config: 'config',
  Metrics: 'metrics',
  Token: 'token',
  Hooks: 'hooks',
  WebHooks: 'webhooks',
  Monitoring: 'monitoring',
  FileSystem: 'fileSystem',
  SessionReplay: 'sessionReplay',
  ReplayStore: 'replayStore',
  SessionRegistry: 'sessionRegistry',
  ReplayCoordinator: 'replayCoordinator',
  BrowserManager: 'browserManager',
  Limiter: 'limiter',
  Router: 'router',
  Logger: 'logger',
} as const;

export type ServiceName = typeof Services[keyof typeof Services];

/**
 * Options for creating a container.
 * Any service can be overridden for testing.
 */
export interface ContainerOptions {
  config?: Config;
  metrics?: Metrics;
  token?: Token;
  hooks?: Hooks;
  webhooks?: WebHooks;
  monitoring?: Monitoring;
  fileSystem?: FileSystem;
  sessionReplay?: SessionReplay;
  replayStore?: IReplayStore;
  sessionRegistry?: SessionRegistry;
  replayCoordinator?: ReplayCoordinator;
  browserManager?: BrowserManager;
  limiter?: Limiter;
  router?: Router;
  Logger?: typeof Logger;
}

/**
 * Create and configure a service container with all Browserless services.
 *
 * Services are registered with their dependencies and can be overridden
 * via the options parameter for testing.
 */
export function createContainer(options: ContainerOptions = {}): ServiceContainer {
  const container = new ServiceContainer();
  const LoggerClass = options.Logger ?? Logger;

  // Core configuration - no dependencies
  container.registerSingleton(Services.Config, () =>
    options.config ?? new Config()
  );

  // Logger factory - for creating named loggers
  container.registerSingleton(Services.Logger, () => LoggerClass);

  // Metrics - no dependencies
  container.registerSingleton(Services.Metrics, () =>
    options.metrics ?? new Metrics()
  );

  // Token - depends on config
  container.registerSingleton(
    Services.Token,
    (c) => options.token ?? new Token(c.resolve<Config>(Services.Config)),
    [Services.Config]
  );

  // Hooks - no dependencies
  container.registerSingleton(Services.Hooks, () =>
    options.hooks ?? new Hooks()
  );

  // WebHooks - depends on config
  container.registerSingleton(
    Services.WebHooks,
    (c) => options.webhooks ?? new WebHooks(c.resolve<Config>(Services.Config)),
    [Services.Config]
  );

  // Monitoring - depends on config
  container.registerSingleton(
    Services.Monitoring,
    (c) => options.monitoring ?? new Monitoring(c.resolve<Config>(Services.Config)),
    [Services.Config]
  );

  // FileSystem - depends on config
  container.registerSingleton(
    Services.FileSystem,
    (c) => options.fileSystem ?? new FileSystem(c.resolve<Config>(Services.Config)),
    [Services.Config]
  );

  // SessionReplay - depends on config
  container.registerSingleton(
    Services.SessionReplay,
    (c) => options.sessionReplay ?? new SessionReplay(c.resolve<Config>(Services.Config)),
    [Services.Config]
  );

  // ReplayStore - lazy initialization based on replays dir
  // This is optional - SessionReplay creates it during initialize()
  if (options.replayStore) {
    container.registerInstance(Services.ReplayStore, options.replayStore);
  }

  // SessionRegistry - no dependencies (pure data structure)
  container.registerSingleton(Services.SessionRegistry, () =>
    options.sessionRegistry ?? new SessionRegistry()
  );

  // ReplayCoordinator - depends on sessionReplay
  container.registerSingleton(
    Services.ReplayCoordinator,
    (c) => options.replayCoordinator ?? new ReplayCoordinator(
      c.resolve<SessionReplay>(Services.SessionReplay)
    ),
    [Services.SessionReplay]
  );

  // BrowserManager - depends on config, hooks, fileSystem, sessionReplay
  container.registerSingleton(
    Services.BrowserManager,
    (c) =>
      options.browserManager ??
      new BrowserManager(
        c.resolve<Config>(Services.Config),
        c.resolve<Hooks>(Services.Hooks),
        c.resolve<FileSystem>(Services.FileSystem),
        c.resolve<SessionReplay>(Services.SessionReplay)
      ),
    [Services.Config, Services.Hooks, Services.FileSystem, Services.SessionReplay]
  );

  // Limiter - depends on config, metrics, monitoring, webhooks, hooks
  container.registerSingleton(
    Services.Limiter,
    (c) =>
      options.limiter ??
      new Limiter(
        c.resolve<Config>(Services.Config),
        c.resolve<Metrics>(Services.Metrics),
        c.resolve<Monitoring>(Services.Monitoring),
        c.resolve<WebHooks>(Services.WebHooks),
        c.resolve<Hooks>(Services.Hooks)
      ),
    [Services.Config, Services.Metrics, Services.Monitoring, Services.WebHooks, Services.Hooks]
  );

  // Router - depends on config, browserManager, limiter
  container.registerSingleton(
    Services.Router,
    (c) =>
      options.router ??
      new Router(
        c.resolve<Config>(Services.Config),
        c.resolve<BrowserManager>(Services.BrowserManager),
        c.resolve<Limiter>(Services.Limiter),
        c.resolve<typeof Logger>(Services.Logger)
      ),
    [Services.Config, Services.BrowserManager, Services.Limiter, Services.Logger]
  );

  return container;
}

/**
 * Create a test container with mocked dependencies.
 * Pass mock implementations for any service you want to replace.
 */
export function createTestContainer(mocks: ContainerOptions = {}): ServiceContainer {
  return createContainer(mocks);
}
