import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

import { BeforeRequest, AfterResponse, BrowserHook, PageHook } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const beforeHookPath = path.join(__dirname, '..', 'external', 'before.js');
const afterHookPath = path.join(__dirname, '..', 'external', 'after.js');
const browserSetupPath = path.join(__dirname, '..', 'external', 'browser.js');
const pageSetupPath = path.join(__dirname, '..', 'external', 'page.js');

export const beforeRequest: (args: BeforeRequest) => boolean = fs.existsSync(
  beforeHookPath,
)
  ? (await import(beforeHookPath)).default
  : () => true;

export const afterRequest: (args: AfterResponse) => boolean = fs.existsSync(
  afterHookPath,
)
  ? (await import(afterHookPath)).default
  : () => true;

export const browserHook: (opts: BrowserHook) => Promise<boolean> =
  fs.existsSync(browserSetupPath)
    ? (await import(browserSetupPath)).default
    : () => Promise.resolve(true);

export const pageHook: (opts: PageHook) => Promise<boolean> = fs.existsSync(
  pageSetupPath,
)
  ? (await import(pageSetupPath)).default
  : () => Promise.resolve(true);
