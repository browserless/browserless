import { Config, Logger, fetchTimeout } from '@browserless.io/browserless';
import { EventEmitter } from 'events';

export class WebHooks extends EventEmitter {
  protected logger = new Logger('webhooks');

  constructor(protected config: Config) {
    super();
  }

  protected callURL(url: string | null) {
    if (url) {
      // Log failures (don't rethrow) — a dead alert URL shouldn't affect
      // request handling, but it must be diagnosable.
      return fetchTimeout(url, {
        method: 'GET',
        timeout: 10000,
      }).catch((err) =>
        this.logger.warn(`Failed calling webhook URL "${url}": ${err}`),
      );
    }

    return;
  }

  public callFailedHealthURL() {
    const url = this.config.getFailedHealthURL();
    return this.callURL(url);
  }

  public callQueueAlertURL() {
    const url = this.config.getQueueAlertURL();
    return this.callURL(url);
  }

  public callRejectAlertURL() {
    const url = this.config.getRejectAlertURL();
    return this.callURL(url);
  }

  public callTimeoutAlertURL() {
    const url = this.config.getTimeoutAlertURL();
    return this.callURL(url);
  }

  public callErrorAlertURL(message: string) {
    const url = this.config.getErrorAlertURL();

    // No alert URL configured is the normal case — don't fall through to
    // `new URL('')` and log a spurious "Invalid URL" on every errored request.
    if (!url) {
      return;
    }

    try {
      const fullURL = new URL(url ?? '');
      fullURL?.searchParams.set('error', message);
      return this.callURL(fullURL.href);
    } catch (err) {
      return console.error(
        `Issue calling error hook: "${err}". Did you set a working ERROR_ALERT_URL env variable?`,
      );
    }
  }

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public async shutdown() {
    return await this.stop();
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
