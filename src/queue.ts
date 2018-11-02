import { IJob, IQueue } from './models/queue.interface';
import { id } from './utils';

interface IQueueConfig {
  autostart: boolean;
  concurrency: number;
  maxQueueLength: number;
  timeout?: number;
}

const q = require('queue');

export class Queue {
  private queue: IQueue<IJob>;
  private maxQueueLength: number;

  constructor(opts: IQueueConfig) {
    this.maxQueueLength = opts.maxQueueLength;
    this.queue = q(opts);
  }

  public on(event: string, cb: () => {}) {
    this.queue.on(event, cb);
  }

  public add(job: IJob) {
    if (!job.id) {
      job.id = id();
    }

    if (!this.canRunImmediately) {
      this.queue.emit('queued');
    }

    this.queue.push(job);
  }

  public remove(job: IJob) {
    const foundIndex = this.queue.indexOf(job);

    if (foundIndex !== -1) {
      this.queue.splice(foundIndex, 1);
    }
  }

  public map(...args) {
    return Array.prototype.map.apply(this.queue, args);
  }

  get length() {
    return this.queue.length;
  }

  get concurrencySize() {
    return this.queue.concurrency;
  }

  get canRunImmediately() {
    return this.length < this.concurrencySize;
  }

  get hasCapacity() {
    return this.length < this.maxQueueLength;
  }
}
