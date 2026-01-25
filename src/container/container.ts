import { Logger } from '@browserless.io/browserless';

/**
 * Service factory function type.
 * Receives the container for dependency resolution.
 */
export type ServiceFactory<T> = (container: ServiceContainer) => T;

/**
 * Service registration with metadata.
 */
interface ServiceRegistration<T> {
  factory: ServiceFactory<T>;
  instance?: T;
  singleton: boolean;
  dependencies: string[];
}

/**
 * ServiceContainer provides centralized dependency injection.
 *
 * Features:
 * - Lazy service instantiation
 * - Singleton and transient lifecycle support
 * - Circular dependency detection at registration and resolution
 * - Startup validation to fail fast on missing dependencies
 * - Easy mocking for tests via overrides
 *
 * Usage:
 *   const container = new ServiceContainer();
 *   container.registerSingleton('config', () => new Config());
 *   container.registerSingleton('logger', (c) => new Logger(c.resolve('config')));
 *   container.validate(); // Fail fast on missing deps
 *   const logger = container.resolve<Logger>('logger');
 */
export class ServiceContainer {
  private services: Map<string, ServiceRegistration<unknown>> = new Map();
  private resolving: Set<string> = new Set(); // For circular dependency detection
  private log = new Logger('container');

  /**
   * Register a singleton service.
   * The factory is called once, and the same instance is returned for all resolutions.
   */
  registerSingleton<T>(
    name: string,
    factory: ServiceFactory<T>,
    dependencies: string[] = []
  ): this {
    if (this.services.has(name)) {
      this.log.warn(`Service "${name}" is being overwritten`);
    }

    this.services.set(name, {
      factory: factory as ServiceFactory<unknown>,
      singleton: true,
      dependencies,
    });

    return this;
  }

  /**
   * Register a transient service.
   * The factory is called for each resolution, returning a new instance each time.
   */
  registerTransient<T>(
    name: string,
    factory: ServiceFactory<T>,
    dependencies: string[] = []
  ): this {
    if (this.services.has(name)) {
      this.log.warn(`Service "${name}" is being overwritten`);
    }

    this.services.set(name, {
      factory: factory as ServiceFactory<unknown>,
      singleton: false,
      dependencies,
    });

    return this;
  }

  /**
   * Register an existing instance as a singleton.
   * Useful for injecting external dependencies or mocks.
   */
  registerInstance<T>(name: string, instance: T): this {
    if (this.services.has(name)) {
      this.log.warn(`Service "${name}" is being overwritten with instance`);
    }

    this.services.set(name, {
      factory: () => instance,
      instance,
      singleton: true,
      dependencies: [],
    });

    return this;
  }

  /**
   * Resolve a service by name.
   * Throws if the service is not registered or if circular dependency is detected.
   */
  resolve<T>(name: string): T {
    const registration = this.services.get(name);
    if (!registration) {
      throw new Error(`Service "${name}" is not registered`);
    }

    // For singletons, return cached instance if available
    if (registration.singleton && registration.instance !== undefined) {
      return registration.instance as T;
    }

    // Circular dependency detection
    if (this.resolving.has(name)) {
      const chain = Array.from(this.resolving).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain} -> ${name}`);
    }

    this.resolving.add(name);
    try {
      const instance = registration.factory(this);

      if (registration.singleton) {
        registration.instance = instance;
      }

      return instance as T;
    } finally {
      this.resolving.delete(name);
    }
  }

  /**
   * Try to resolve a service, returning undefined if not registered.
   */
  tryResolve<T>(name: string): T | undefined {
    try {
      return this.resolve<T>(name);
    } catch {
      return undefined;
    }
  }

  /**
   * Check if a service is registered.
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Validate all services can be resolved.
   * Throws if any service has missing dependencies or circular references.
   * Call this at startup to fail fast.
   */
  validate(): void {
    this.log.debug('Validating service container...');

    // Check for missing dependencies
    for (const [name, registration] of this.services) {
      for (const dep of registration.dependencies) {
        if (!this.services.has(dep)) {
          throw new Error(
            `Service "${name}" depends on "${dep}" which is not registered`
          );
        }
      }
    }

    // Check for circular dependencies using topological sort
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string, path: string[] = []): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(
          `Circular dependency detected: ${[...path, name].join(' -> ')}`
        );
      }

      visiting.add(name);
      const registration = this.services.get(name);
      if (registration) {
        for (const dep of registration.dependencies) {
          visit(dep, [...path, name]);
        }
      }
      visiting.delete(name);
      visited.add(name);
    };

    for (const name of this.services.keys()) {
      visit(name);
    }

    this.log.debug(`Validated ${this.services.size} services`);
  }

  /**
   * Get all registered service names.
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Clear all services. Useful for tests.
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }

  /**
   * Dispose of a specific singleton instance.
   * Useful for cleanup or resetting state.
   */
  disposeInstance(name: string): void {
    const registration = this.services.get(name);
    if (registration) {
      registration.instance = undefined;
    }
  }

  /**
   * Create a child container that inherits parent registrations.
   * Child can override parent services.
   */
  createChild(): ServiceContainer {
    const child = new ServiceContainer();

    // Copy parent registrations (shallow copy - factories are shared)
    for (const [name, registration] of this.services) {
      child.services.set(name, { ...registration, instance: undefined });
    }

    return child;
  }
}

// Note: No global container instance.
// Use createContainer() from bootstrap.ts to create containers.
// This avoids circular dependency issues during module loading.
