import * as EventEmitter from 'events';
import { Browser } from 'puppeteer';
import { BrowserlessSandbox } from '../Sandbox';

export interface IJob {
  (done?: () => {}): any | Promise<any>;
  id?: string;
  browser?: Browser | BrowserlessSandbox | null;
  close?: () => any;
  timeout?: () => any;
}

export interface IQueue<IJob> extends EventEmitter, Array<IJob> {
  readonly concurrency: number;
  remove: (job: IJob) => any;
  add: (job: IJob) => any;
}

export type IDone = (error?: Error) => any;
