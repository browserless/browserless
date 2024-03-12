// @ts-nocheck Unknown external files
import { EventEmitter } from 'events';

// KEPT for backwards compatibility reasons since some downstream
// docker images will override these files to inject their own hook
// behaviors
import { default as afterRequest } from '../external/after.js';
import { default as beforeRequest } from '../external/before.js';
import { default as browserHook } from '../external/browser.js';
import { default as pageHook } from '../external/page.js';

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
