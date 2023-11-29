import {
  AfterResponse,
  Config,
  Metrics,
  Monitoring,
  TooManyRequests,
  WebHooks,
  afterRequest,
  createLogger,
} from '@browserless.io/browserless';
import q from 'queue';

export type LimitFn<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult>;

export type ErrorFn<TArgs extends unknown[]> = (...args: TArgs) => void;

interface Job {
  (): Promise<unknown>;
  args: unknown[];
  onTimeoutFn: (job: Job) => unknown;
  start: number;
  timeout: number;
}

export class Limiter extends q {
  private queued: number;
  private debug = createLogger('limiter');

  constructor(
    private config: Config,
    private metrics: Metrics,
    private monitor: Monitoring,
    private webhooks: WebHooks,
  ) {
    super({
      autostart: true,
      concurrency: config.getConcurrent(),
      timeout: config.getTimeout(),
    });

    this.queued = config.getQueued();

    this.debug(
      `Concurrency: ${this.concurrency} queue: ${this.queued} timeout: ${this.timeout}ms`,
    );

    config.on('concurrent', (concurrency: number) => {
      this.debug(`Concurrency updated to ${concurrency}`);
      this.concurrency = concurrency;
    });

    config.on('queued', (queued: number) => {
      this.debug(`Queue updated to ${queued}`);
      this.queued = queued;
    });

    config.on('timeout', (timeout: number) => {
      this.debug(`Timeout updated to ${timeout}ms`);
      this.timeout = timeout <= 0 ? 0 : timeout;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.addEventListener('timeout', this.handleJobTimeout as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.addEventListener('success', this.handleSuccess as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.addEventListener('error', this.handleFail as any);

    this.addEventListener('end', this.handleEnd);
  }

  private handleEnd() {
    this.logQueue('All jobs complete.');
  }

  private handleSuccess({ detail: { job } }: { detail: { job: Job } }) {
    const timeUsed = Date.now() - job.start;
    this.debug(
      `Job has succeeded after ${timeUsed.toLocaleString()}ms of activity.`,
    );
    this.metrics.addSuccessful(Date.now() - job.start);
    // @TODO Figure out a better argument handling for jobs
    afterRequest({
      req: job.args[0],
      start: job.start,
      status: 'successful',
    } as AfterResponse);
  }

  private handleJobTimeout({
    detail: { next, job },
  }: {
    detail: { job: Job; next: Job };
  }) {
    const timeUsed = Date.now() - job.start;
    this.debug(
      `Job has hit timeout after ${timeUsed.toLocaleString()}ms of activity.`,
    );
    this.metrics.addTimedout(Date.now() - job.start);
    this.webhooks.callTimeoutAlertURL();
    this.debug(`Calling timeout handler`);
    job?.onTimeoutFn(job);
    afterRequest({
      req: job.args[0],
      start: job.start,
      status: 'timedout',
    } as AfterResponse);

    next();
  }

  private handleFail({
    detail: { error, job },
  }: {
    detail: { error: unknown; job: Job };
  }) {
    this.debug(`Recording failed stat, cleaning up: "${error?.toString()}"`);
    this.metrics.addError(Date.now() - job.start);
    this.webhooks.callErrorAlertURL(error?.toString() ?? 'Unknown Error');
    afterRequest({
      req: job.args[0],
      start: job.start,
      status: 'error',
    } as AfterResponse);
  }

  private logQueue(message: string) {
    this.debug(
      `(Running: ${this.executing}, Pending: ${this.waiting}) ${message} `,
    );
  }

  get executing(): number {
    return this.length > this.concurrency ? this.concurrency : this.length;
  }

  get waiting(): number {
    return this.length > this.concurrency ? this.length - this.concurrency : 0;
  }

  get willQueue(): boolean {
    return this.length >= this.concurrency;
  }

  get concurrencySize(): number {
    return this.concurrency;
  }

  get hasCapacity(): boolean {
    return this.length < this.concurrency + this.queued;
  }

  public limit = <TArgs extends unknown[], TResult>(
    limitFn: LimitFn<TArgs, TResult>,
    overCapacityFn: ErrorFn<TArgs>,
    onTimeoutFn: ErrorFn<TArgs>,
    timeoutOverrideFn: (...args: TArgs) => number | undefined,
  ): LimitFn<TArgs, unknown> => {
    return (...args: TArgs) =>
      new Promise(async (res, rej) => {
        const timeout = timeoutOverrideFn(...args) ?? this.timeout;
        this.logQueue(
          `Adding to queue, max time allowed is ${timeout.toLocaleString()}ms`,
        );

        if (this.config.getHealthChecksEnabled()) {
          const { cpuOverloaded, memoryOverloaded } =
            await this.monitor.overloaded();

          if (cpuOverloaded || memoryOverloaded) {
            this.logQueue(`Health checks have failed, rejecting`);
            this.webhooks.callFailedHealthURL();
            this.metrics.addRejected();
            overCapacityFn(...args);
            return rej(new Error(`Health checks have failed, rejecting`));
          }
        }

        if (!this.hasCapacity) {
          this.logQueue(`Concurrency and queue is at capacity`);
          this.webhooks.callRejectAlertURL();
          this.metrics.addRejected();
          overCapacityFn(...args);
          return rej(
            new TooManyRequests(`Concurrency and queue is at capacity`),
          );
        }

        if (this.willQueue) {
          this.logQueue(`Concurrency is at capacity, queueing`);
          this.webhooks.callQueueAlertURL();
          this.metrics.addQueued();
        }

        const bound: () => Promise<TResult | unknown> = async () => {
          this.logQueue(`Starting new job`);
          this.metrics.addRunning();

          try {
            const result = await limitFn(...args);
            res(result);
            return;
          } catch (err) {
            rej(err);
            throw err;
          }
        };

        const job: Job = Object.assign(bound, {
          args,
          onTimeoutFn: () => onTimeoutFn(...args),
          start: Date.now(),
          timeout,
        });

        this.push(job);

        return bound;
      });
  };
}
