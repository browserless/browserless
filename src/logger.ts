import { Request, createLogger } from '@browserless.io/browserless';

export class Logger {
  protected _trace: (...args: unknown[]) => void;
  protected _debug: (...args: unknown[]) => void;
  protected _info: (...args: unknown[]) => void;
  protected _warn: (...args: unknown[]) => void;
  protected _error: (...args: unknown[]) => void;
  protected _fatal: (...args: unknown[]) => void;

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
  }

  protected get reqInfo() {
    return this.request ? (this.request.socket.remoteAddress ?? 'Unknown') : '';
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
}
