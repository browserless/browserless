import { Request, createLogger } from '@browserless.io/browserless';

export class Logger {
  protected _log: ReturnType<typeof createLogger>;
  protected _verbose: ReturnType<typeof createLogger>;
  protected _error: ReturnType<typeof createLogger>;

  constructor(
    protected prefix: string,
    protected request: Request,
  ) {
    this._log = createLogger(prefix);
    this._verbose = this._log.extend('verbose');
    this._error = this._log.extend('error');
  }

  public verbose(...messages: string[]) {
    const ip = this.request.socket.remoteAddress ?? 'Unknown';
    this._verbose(ip, ...messages);
  }

  public log(...messages: string[]) {
    const ip = this.request.socket.remoteAddress ?? 'Unknown';
    this._log(ip, ...messages);
  }

  public error(...messages: string[]) {
    const ip = this.request.socket.remoteAddress ?? 'Unknown';
    this._error(ip, ...messages);
  }
}
