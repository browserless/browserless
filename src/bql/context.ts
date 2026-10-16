import { BQLBrowserAPI } from '@browserless.io/browserless';

export type BQLContextOptions = ConstructorParameters<typeof BQLBrowserAPI>[0];
export type APIFactory<API extends BQLBrowserAPI = BQLBrowserAPI> = (
  options: BQLContextOptions,
) => API;

/** A request or socket owns one lazily initialized API and its event sources. */
export class Context<API extends BQLBrowserAPI = BQLBrowserAPI> {
  private started?: Promise<API>;
  private api?: API;
  private disconnectListeners = new Set<() => void>();
  private disconnectBridge?: () => void;
  private closing?: Promise<void>;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private cleanups = new Set<() => Promise<unknown>>();

  constructor(
    private readonly options: BQLContextOptions,
    private readonly factory: APIFactory<API>,
  ) {}

  public getBrowser(): Promise<API> {
    if (this.closed)
      return Promise.reject(new Error('BrowserQL context is closed'));
    if (!this.started) {
      this.started = Promise.resolve().then(async () => {
        const api = this.factory(this.options);
        this.api = api;
        this.disconnectBridge = api.onDisconnected(() => {
          if (!this.closed)
            for (const listener of this.disconnectListeners) listener();
        });
        try {
          await api.start();
          return api;
        } catch (error) {
          this.disconnectBridge?.();
          this.disconnectBridge = undefined;
          await api.close();
          throw error;
        }
      });
    }
    return this.started;
  }

  public runSerial<T>(handler: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.closed) throw new Error('BrowserQL context is closed');
      return handler();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  public onClose(cleanup: () => Promise<unknown>): () => void {
    if (this.closed) throw new Error('BrowserQL context is closed');
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  public getRequest() {
    return this.options.req;
  }
  public getConfig() {
    return this.options.config;
  }
  public getLogger() {
    return this.options.logger;
  }
  public getBrowserInstance() {
    return this.options.browser;
  }

  public hasErrored(): boolean {
    return this.api?.hasErrored() ?? false;
  }

  public onDisconnected(listener: () => void): () => void {
    if (this.closed) return () => {};
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  public close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.disconnectListeners.clear();
    this.closing = (async () => {
      try {
        await Promise.all([...this.cleanups].map((cleanup) => cleanup()));
      } finally {
        this.cleanups.clear();
        const api = await this.started?.catch(() => undefined);
        this.disconnectBridge?.();
        this.disconnectBridge = undefined;
        await api?.close();
      }
    })();
    return this.closing;
  }
}
