import { EventEmitter } from 'events';

// @ts-ignore
import { default as beforeRequest } from '../external/before.js';
// @ts-ignore
import { default as afterRequest } from '../external/after.js';
// @ts-ignore
import { default as pageHook } from '../external/page.js';
// @ts-ignore
import { default as browserHook } from '../external/browser.js';

export class Hooks extends EventEmitter {
  constructor() {
    super();
  }

  before(...args: unknown[]): Promise<boolean> {
    return beforeRequest(...args);
  }

  after(...args: unknown[]): Promise<boolean> {
    return afterRequest(...args);
  }

  page(...args: unknown[]): Promise<unknown> {
    return pageHook(...args);
  }

  browser(...args: unknown[]): Promise<unknown> {
    return browserHook(...args);
  }
}
