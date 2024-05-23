import {
  AfterResponse,
  BeforeRequest,
  BrowserHook,
  PageHook,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';

// KEPT for backwards compatibility reasons since some downstream
// docker images will override these files to inject their own hook
// behaviors
// @ts-ignore
import { default as afterRequest } from '../external/after.js';
// @ts-ignore
import { default as beforeRequest } from '../external/before.js';
// @ts-ignore
import { default as browserHook } from '../external/browser.js';
// @ts-ignore
import { default as pageHook } from '../external/page.js';

export class Hooks extends EventEmitter {
  before(args: BeforeRequest): Promise<boolean> {
    return beforeRequest(args);
  }

  after(args: AfterResponse): Promise<unknown> {
    return afterRequest(args);
  }

  page(args: PageHook): Promise<unknown> {
    return pageHook(args);
  }

  browser(args: BrowserHook): Promise<unknown> {
    return browserHook(args);
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
