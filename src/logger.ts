import { Request } from '@browserless.io/browserless';
import { getTokenFromRequest } from './utils.js';
import winston from 'winston';

const customerIdLength = 14;

export interface SessionMetadata {
  sessionId?: string;
  routeName?: string;
  method?: string;
  path?: string;
  userAgent?: string;
  startedAt?: number;
  requestId?: string;
  browserId?: string;
  [key: string]: unknown;
}

interface LogMessage {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';
  name: string;
  timestamp: string;
  requestId?: string;
  browserId?: string;
  message: string;
  data?: {
    ip?: string;
    port?: number;
    sessionId?: string;
    routeName?: string;
    method?: string;
    path?: string;
    trackingId?: string;
    userAgent?: string;
    startedAt?: number;
    [key: string]: unknown;
  };
}

export class Logger {
  protected logger: winston.Logger;

  // Memoized session details
  protected sessionMetadata: SessionMetadata = {};

  constructor(
    protected prefix: string,
    protected request?: Request,
  ) {
    this.logger = winston.createLogger({
      level: process.env.CLOUD_LOG_LEVEL ?? (process.env.DEBUG ? 'trace' : 'info'),
      levels: {
        fatal: 0,
        error: 1,
        warn: 2,
        info: 3,
        debug: 4,
        trace: 5,
      },
      format: winston.format.json(),
      transports: [new winston.transports.Console()],
    });

    // Initialize session metadata from request if provided
    if (request) {
      this.initializeSessionMetadata(request);
    }
  }

  /**
   * Initialize session metadata from the request object
   */
  protected initializeSessionMetadata(req: Request): void {
    const requestId = this.generateRequestId();
    this.sessionMetadata = {
      requestId,
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
   * Generate a unique request ID if not already set
   */
  protected generateRequestId(): string {
    if (this.sessionMetadata.requestId) {
      return this.sessionMetadata.requestId;
    }
    // Generate a simple request ID based on timestamp and random
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get tracking ID from token and request ID
   */
  protected getTrackingId(): string {
    if (!this.request) {
      return this.sessionMetadata.requestId || '';
    }
    let token = getTokenFromRequest(this.request);
    if (!token) {
      return this.sessionMetadata.requestId || '';
    }
    const isLegacyToken = token.length > 32;
    if (!isLegacyToken) {
      token = token.slice(0, customerIdLength);
    }
    const requestId = this.sessionMetadata.requestId || this.generateRequestId();
    return `${token} ${requestId}`;
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

  /**
   * Format message arguments into a single string
   */
  protected formatMessage(messages: unknown[]): string {
    return messages
      .map((msg) => {
        if (msg instanceof Error) {
          return `${msg.name}: ${msg.message}${msg.stack ? '\n' + msg.stack : ''}`;
        }
        if (typeof msg === 'object') {
          try {
            return JSON.stringify(msg);
          } catch {
            return '[Unserializable Object]';
          }
        }
        return String(msg);
      })
      .join(' ');
  }

  /**
   * Create structured log message
   */
  protected createLogMessage(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    messages: unknown[],
  ): LogMessage {
    const trackingId = this.getTrackingId();
    const remoteAddress = this.request?.socket.remoteAddress || (typeof this.sessionMetadata.remoteAddress === 'string' ? this.sessionMetadata.remoteAddress : undefined);
    const port = this.request?.socket.remotePort;
    
    // Build data object with all metadata
    const dataEntries: Record<string, unknown> = {};
    
    if (remoteAddress) {
      dataEntries.ip = remoteAddress;
    }
    if (port) {
      dataEntries.port = port;
    }
    if (this.sessionMetadata.sessionId) {
      dataEntries.sessionId = this.sessionMetadata.sessionId;
    }
    if (this.sessionMetadata.routeName) {
      dataEntries.routeName = this.sessionMetadata.routeName;
    }
    if (this.sessionMetadata.method) {
      dataEntries.method = this.sessionMetadata.method;
    }
    if (this.sessionMetadata.path) {
      dataEntries.path = this.sessionMetadata.path;
    }
    if (trackingId) {
      dataEntries.trackingId = trackingId;
    }
    if (typeof this.sessionMetadata.userAgent === 'string') {
      dataEntries.userAgent = this.sessionMetadata.userAgent;
    }
    if (typeof this.sessionMetadata.startedAt === 'number') {
      dataEntries.startedAt = this.sessionMetadata.startedAt;
    }
    
    // Add any additional custom metadata
    Object.entries(this.sessionMetadata).forEach(([k, v]) => {
      if (!['requestId', 'sessionId', 'routeName', 'method', 'path', 'browserId', 'remoteAddress', 'userAgent', 'startedAt'].includes(k) && v !== undefined) {
        dataEntries[k] = v;
      }
    });

    const message: LogMessage = {
      level,
      name: `browserless.io:${this.prefix}`,
      timestamp: new Date().toISOString(),
      message: this.formatMessage(messages),
      ...(this.sessionMetadata.requestId && { requestId: this.sessionMetadata.requestId }),
      ...(this.sessionMetadata.browserId && { browserId: this.sessionMetadata.browserId }),
      ...(Object.keys(dataEntries).length > 0 && { data: dataEntries }),
    };

    return message;
  }

  public trace(...messages: unknown[]) {
    const logMessage = this.createLogMessage('trace', messages);
    this.logger.log(logMessage);
  }

  public debug(...messages: unknown[]) {
    const logMessage = this.createLogMessage('debug', messages);
    this.logger.debug(logMessage);
  }

  public info(...messages: unknown[]) {
    const logMessage = this.createLogMessage('info', messages);
    this.logger.info(logMessage);
  }

  public warn(...messages: unknown[]) {
    const logMessage = this.createLogMessage('warn', messages);
    this.logger.warn(logMessage);
  }

  public error(...messages: unknown[]) {
    const logMessage = this.createLogMessage('error', messages);
    this.logger.error(logMessage);
  }

  public fatal(...messages: unknown[]) {
    const logMessage = this.createLogMessage('fatal', messages);
    this.logger.log(logMessage);
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
