import * as EventEmitter from 'events';
import { Browser } from 'puppeteer';

export interface IJob {
  (done?: () => {}): any | Promise<any>;
  id: string;
  browser: Browser | null;
  close: () => any;
}

export interface IQueue<IJob> extends EventEmitter, Array<IJob> {
  readonly concurrency: number;
  remove: (job: IJob) => any;
  add: (job: IJob) => any;
}
