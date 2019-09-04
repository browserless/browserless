import * as EventEmitter from 'events';
import * as _ from 'lodash';
import q from 'queue';

import { IWebdriverStartHTTP } from './browserless';
import { IBrowser } from './chrome-helper';
import { BrowserlessSandbox } from './Sandbox';
import * as util from './utils';

export interface IJob {
  (done?: IDone): any | Promise<any>;
  id?: string;
  browser?: IBrowser | BrowserlessSandbox | null;
  close?: () => any;
  onTimeout?: () => any;
  start: number;
  req: util.IHTTPRequest | IWebdriverStartHTTP;
  timeout?: number | undefined;
}

export interface IQueue<IJob> extends EventEmitter, Array<IJob> {
  readonly concurrency: number;
  remove: (job: IJob) => any;
  add: (job: IJob) => any;
}

export type IDone = (error?: Error) => any;

interface IQueueConfig {
  autostart: boolean;
  concurrency: number;
  maxQueueLength: number;
  timeout?: number;
}

export class Queue {
  private queue: q;
  private maxQueueLength: number;

  constructor(opts: IQueueConfig) {
    this.maxQueueLength = opts.maxQueueLength;
    this.queue = q(opts);
  }

  public on(event: string, cb: () => any) {
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
