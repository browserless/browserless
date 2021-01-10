import _ from 'lodash';
import q from 'queue';

import { overloaded } from './hardware-monitoring';
import * as util from './utils';

import {
  IJob,
  IQueueConfig,
} from './types';

import { PRE_REQUEST_HEALTH_CHECK } from './config';

export class Queue {
  private queue: q;
  private maxQueueLength: number;

  constructor(opts: IQueueConfig) {
    this.maxQueueLength = opts.maxQueueLength;
    this.queue = q(opts);
  }

  public on(event: string, cb: (...args: any[]) => any) {
    this.queue.on(event, cb);
  }

  public removeAllListeners() {
    this.queue.removeAllListeners();
  }

  public add(job: IJob) {
    if (!job.id) {
      job.id = util.id();
    }

    if (!this.canRunImmediately) {
      this.queue.emit('queued');
    }

    if (!job.hasOwnProperty('timeout')) {
      const timeout = util.getTimeoutParam(job.req);

      if (timeout !== null) {
        job.timeout = timeout;
      }
    }

    this.queue.push(job);
  }

  public async overloaded() {
    const { cpuOverloaded, memoryOverloaded } = await overloaded();
    const underLoad = cpuOverloaded || memoryOverloaded;

    return PRE_REQUEST_HEALTH_CHECK && underLoad;
  }

  public remove(job: IJob) {
    const foundIndex = this.queue.indexOf(job);

    if (foundIndex !== -1) {
      this.queue.splice(foundIndex, 1);
    }
  }

  public map(mapFn: (job: IJob) => any) {
    return Array.prototype.map.call(this.queue, mapFn);
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
