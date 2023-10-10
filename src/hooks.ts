import fs from 'fs';
import path from 'path';

import { BeforeRequest, AfterResponse, BrowserHook, PageHook } from './types';

const beforeHookPath = path.join(__dirname, '..', 'external', 'before.js');
const afterHookPath = path.join(__dirname, '..', 'external', 'after.js');
const browserSetupPath = path.join(__dirname, '..', 'external', 'browser.js');
const pageSetupPath = path.join(__dirname, '..', 'external', 'page.js');

export const beforeRequest: (args: BeforeRequest) => boolean = fs.existsSync(
  beforeHookPath,
)
  ? await import(beforeHookPath)
  : () => true;

export const afterRequest: (args: AfterResponse) => boolean = fs.existsSync(
  afterHookPath,
)
  ? await import(afterHookPath)
  : () => true;

export const browserHook: (opts: BrowserHook) => Promise<boolean> =
  fs.existsSync(browserSetupPath)
    ? await import(browserSetupPath)
    : () => Promise.resolve(true);

export const pageHook: (opts: PageHook) => Promise<boolean> = fs.existsSync(
  pageSetupPath,
)
  ? require(pageSetupPath)
  : () => Promise.resolve(true);
