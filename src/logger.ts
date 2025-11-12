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
  }

  /**
   * Updates a specific session context value
   *
   * @param key - Context key to update
   * @param value - Context value
   */
  public setSessionValue(key: string, value: string): void {
    this.sessionContext[key] = value;
  }

  /**
   * Returns the current session context
   */
  public getSessionContext(): SessionContext {
    return { ...this.sessionContext };
  }

  /**
   * Builds the context prefix that will be included in every log message.
   * Format: [IP] [trackingId=xxx] [sessionId=xxx] [path] [method]
   */
  protected get contextPrefix(): string {
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

    return parts.length > 0 ? parts.join(' ') : '';
  }

  public trace(...messages: unknown[]) {
    const prefix = this.contextPrefix;
    if (prefix) {
      this._trace(prefix, ...messages);
    } else {
      this._trace(...messages);
    }
  }

  public debug(...messages: unknown[]) {
    const prefix = this.contextPrefix;
    if (prefix) {
      this._debug(prefix, ...messages);
    } else {
      this._debug(...messages);
    }
  }

  public info(...messages: unknown[]) {
    const prefix = this.contextPrefix;
    if (prefix) {
      this._info(prefix, ...messages);
    } else {
      this._info(...messages);
    }
  }

  public warn(...messages: unknown[]) {
    const prefix = this.contextPrefix;
    if (prefix) {
      this._warn(prefix, ...messages);
    } else {
      this._warn(...messages);
    }
  }

  public error(...messages: unknown[]) {
    const prefix = this.contextPrefix;
    if (prefix) {
      this._error(prefix, ...messages);
    } else {
      this._error(...messages);
    }
  }

  public fatal(...messages: unknown[]) {
    const prefix = this.contextPrefix;
    if (prefix) {
      this._fatal(prefix, ...messages);
    } else {
      this._fatal(...messages);
    }
  }
}
