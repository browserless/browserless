import { Request, createLogger } from '@browserless.io/browserless';

export class Logger {
  protected debugger: ReturnType<typeof createLogger>;

  constructor(
    protected prefix: string,
    protected request: Request,
  ) {
    this.debugger = createLogger(prefix);
  }

  public extend(prefix: string) {
    return new Logger(this.prefix + prefix, this.request);
  }

  public log(...messages: string[]) {
    const ip = this.request.socket.remoteAddress ?? 'Unknown';
    this.debugger(ip, ...messages);
  }
}
