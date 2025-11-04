import { Request, createLogger } from '@browserless.io/browserless';

export interface SessionMetadata {
  sessionId?: string;
  routeName?: string;
  method?: string;
  path?: string;
  userAgent?: string;
  startedAt?: number;
  [key: string]: unknown;
}

export class Logger {
  protected _trace: (...args: unknown[]) => void;
  protected _debug: (...args: unknown[]) => void;
  protected _info: (...args: unknown[]) => void;
  protected _warn: (...args: unknown[]) => void;
  protected _error: (...args: unknown[]) => void;
  protected _fatal: (...args: unknown[]) => void;

  // Memoized session details
  protected sessionMetadata: SessionMetadata = {};

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

    // Initialize session metadata from request if provided
    if (request) {
      this.initializeSessionMetadata(request);
    }
  }

  /**
   * Initialize session metadata from the request object
   */
  protected initializeSessionMetadata(req: Request): void {
    this.sessionMetadata = {
      sessionId: this.getSessionId(),
      routeName: this.prefix,
      method: req.method,
      path: req.parsed?.pathname || req.url || 'Unknown',
      userAgent: req.headers['user-agent'],
      remoteAddress: req.socket?.remoteAddress || 'Unknown',
      startedAt: Date.now(),
    };
  }

  /**
   * Update or extend session metadata
   */
  public setMetadata(key: string, value: unknown): void {
    this.sessionMetadata[key] = value;
  }

  /**
   * Get session metadata
   */
  public getMetadata(): SessionMetadata {
    return { ...this.sessionMetadata };
  }

  /**
   * Get a child logger with extended prefix
   */
  public createChild(prefix: string): Logger {
    const child = new Logger(`${this.prefix}:${prefix}`, this.request);
    child.sessionMetadata = { ...this.sessionMetadata };
    return child;
  }

  protected get reqInfo() {
    const parts = [this.sessionMetadata.remoteAddress || 'Unknown'];
    if (this.sessionMetadata.sessionId) {
      parts.push(`session:${this.sessionMetadata.sessionId}`);
    }
    return parts.join(' ');
  }

  protected getSessionId(): string | undefined {
    // Try to extract session ID from request headers or URL
    const sessionHeader = this.request?.headers['x-session-id'];
    if (sessionHeader) {
      return String(sessionHeader);
    }

    // Try to extract from URL path (e.g., /devtools/page/{sessionId})
    const match = this.request?.parsed?.pathname?.match(
      /[a-zA-Z0-9]{32}|[a-zA-Z0-9-]{36}/,
    );
    return match?.[0];
  }

  public trace(...messages: unknown[]) {
    this._trace(this.reqInfo, ...messages);
  }

  public debug(...messages: unknown[]) {
    this._debug(this.reqInfo, ...messages);
  }

  public info(...messages: unknown[]) {
    this._info(this.reqInfo, ...messages);
  }

  public warn(...messages: unknown[]) {
    this._warn(this.reqInfo, ...messages);
  }

  public error(...messages: unknown[]) {
    this._error(this.reqInfo, ...messages);
  }

  public fatal(...messages: unknown[]) {
    this._fatal(this.reqInfo, ...messages);
  }

  /**
   * Log with session context
   */
  public logWithContext(level: 'info' | 'debug' | 'warn' | 'error', ...messages: unknown[]) {
    const contextMsg = `[${Object.entries(this.sessionMetadata)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}]`;
    this[level](contextMsg, ...messages);
  }
}
