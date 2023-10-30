import { IBrowserlessStats } from './types';

export class Metrics {
  private sessionTimes: number[] = [];
  private successful = 0;
  private queued = 0;
  private rejected = 0;
  private unauthorized = 0;
  private concurrent = 0;
  private timedout = 0;
  private running = 0;
  private unhealthy = 0;
  private error = 0;

  addSuccessful = (sessionTime: number): number => {
    --this.running;
    this.sessionTimes.push(sessionTime);
    return ++this.successful;
  };

  addTimedout = (sessionTime: number): number => {
    --this.running;
    this.sessionTimes.push(sessionTime);
    return ++this.timedout;
  };

  addError = (sessionTime: number): number => {
    --this.running;
    this.sessionTimes.push(sessionTime);
    return ++this.error;
  };

  addQueued = (): number => {
    return ++this.queued;
  };

  addRejected = (): number => {
    return ++this.rejected;
  };

  addUnhealthy = (): number => {
    return ++this.unhealthy;
  };

  addUnauthorized = (): number => {
    return ++this.unauthorized;
  };

  addRunning = (): number => {
    ++this.running;

    if (this.concurrent < this.running) {
      this.concurrent = this.running;
    }

    return this.running;
  };

  public get = (): Omit<IBrowserlessStats, 'cpu' | 'memory'> => {
    const currentStat = {
      error: this.error,
      maxConcurrent: this.concurrent,
      queued: this.queued,
      rejected: this.rejected,
      running: this.running,
      sessionTimes: this.sessionTimes,
      successful: this.successful,
      timedout: this.timedout,
      unauthorized: this.unauthorized,
      unhealthy: this.unhealthy,
    };

    return {
      ...currentStat,
      ...this.calculateStats(currentStat.sessionTimes),
      date: Date.now(),
    };
  };

  public reset = () => {
    this.successful = 0;
    this.error = 0;
    this.queued = 0;
    this.rejected = 0;
    this.unauthorized = 0;
    this.concurrent = 0;
    this.timedout = 0;
    this.running = 0;
    this.unhealthy = 0;
    this.sessionTimes = [];
  };

  private calculateStats(sessionTimes: number[]) {
    return {
      maxTime: Math.max(...sessionTimes) || 0,
      meanTime: sessionTimes.reduce(
        (avg, value, _, { length }) => avg + value / length,
        0,
      ),
      minTime: Math.min(...sessionTimes) || 0,
      totalTime: sessionTimes.reduce((sum, value) => sum + value, 0),
      units: sessionTimes.reduce(
        (sum, value) => sum + Math.ceil(value / 30000),
        0,
      ),
    };
  }
}
