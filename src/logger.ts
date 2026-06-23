import { Request, createLogger } from '@browserless.io/browserless';

export interface SessionContext {
  trackingId?: string;
  sessionId?: string;
  path?: string;
  method?: string;
  [key: string]: string | undefined;
}

export class Logger {
  protected _trace: (...args: unknown[]) => void;
  protected _debug: (...args: unknown[]) => void;
  protected _info: (...args: unknown[]) => void;
  protected _warn: (...args: unknown[]) => void;
  protected _error: (...args: unknown[]) => void;
  protected _fatal: (...args: unknown[]) => void;
  protected sessionContext: SessionContext = {};

  constructor(
    protected prefix: string,
    protected request?: Request,
  ) {
    const logger = createLogger(prefix);

    this._trace = logger.extend('trace');
    this._debug = logger.extend('debug');
    this._info = logger.extend('info');
    this._warn = logger.extend('warn');
    this._error = logger.extend('error');
    this._fatal = logger.extend('fatal');

    // Initialize session context from request if available
    if (request) {
      this.sessionContext.path = request.parsed?.pathname;
      this.sessionContext.method = request.method;
    }
  }

  /**
   * Sets session-specific context that will be included in all log messages.
   * This allows downstream components to add context like trackingId, sessionId, etc.
   *
   * @param context - Session context to merge with existing context
   */
  public setSessionContext(context: SessionContext): void {
    this.sessionContext = { ...this.sessionContext, ...context };
    this.cachedContextPrefix = null;
  }

  /**
   * Updates a specific session context value
   *
   * @param key - Context key to update
   * @param value - Context value
   */
  public setSessionValue(key: string, value: string): void {
    this.sessionContext[key] = value;
    this.cachedContextPrefix = null;
  }

  /**
   * Returns the current session context
   */
  public getSessionContext(): SessionContext {
    return { ...this.sessionContext };
  }

  // Cached so high-volume logging doesn't rebuild the same strings on
  // every call; invalidated when session context changes.
  protected cachedContextPrefix: string | null = null;

  /**
   * Builds the context prefix that will be included in every log message.
   * Format: [IP] [trackingId=xxx] [sessionId=xxx] [path] [method]
   */
  protected get contextPrefix(): string {
    if (this.cachedContextPrefix !== null) {
      return this.cachedContextPrefix;
    }
    const parts: string[] = [];

    // Add IP address
    if (this.request?.socket.remoteAddress) {
      parts.push(`[${this.request.socket.remoteAddress}]`);
    }

    // Add tracking ID if available
    if (this.sessionContext.trackingId) {
      parts.push(`[trackingId=${this.sessionContext.trackingId}]`);
    }

    // Add session ID if available
    if (this.sessionContext.sessionId) {
      parts.push(`[sessionId=${this.sessionContext.sessionId}]`);
    }

    // Add method and path for request context
    if (this.sessionContext.method && this.sessionContext.path) {
      parts.push(`[${this.sessionContext.method} ${this.sessionContext.path}]`);
    }

    return (this.cachedContextPrefix = parts.length > 0 ? parts.join(' ') : '');
  }

  // Skips prefix construction entirely when the underlying debug namespace
  // is disabled (the common case for trace/debug in production). Falls
  // through when `enabled` is absent, e.g. SDK overrides with plain fns.
  protected emit(fn: (...args: unknown[]) => void, messages: unknown[]) {
    if ((fn as { enabled?: boolean }).enabled === false) {
      return;
    }
    const prefix = this.contextPrefix;
    if (prefix) {
      fn(prefix, ...messages);
    } else {
      fn(...messages);
    }
  }

  public trace(...messages: unknown[]) {
    this.emit(this._trace, messages);
  }

  public debug(...messages: unknown[]) {
    this.emit(this._debug, messages);
  }

  public info(...messages: unknown[]) {
    this.emit(this._info, messages);
  }

  public warn(...messages: unknown[]) {
    this.emit(this._warn, messages);
  }

  public error(...messages: unknown[]) {
    this.emit(this._error, messages);
  }

  public fatal(...messages: unknown[]) {
    this.emit(this._fatal, messages);
  }
}
