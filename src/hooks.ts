import fs from 'fs';
import path from 'path';

import { Router } from 'express';
import puppeteer from 'puppeteer';

import {
  IBrowserHook,
  IPageHook,
  IBeforeHookRequest,
  IAfterHookResponse,
  ILaunchOptions,
} from './types.d';

const beforeHookPath = path.join(__dirname, '..', 'external', 'before.js');
const afterHookPath = path.join(__dirname, '..', 'external', 'after.js');
const browserSetupPath = path.join(__dirname, '..', 'external', 'browser.js');
const pageSetupPath = path.join(__dirname, '..', 'external', 'page.js');
const puppeteerSetupPath = path.join(
  __dirname,
  '..',
  'external',
  'puppeteer.js',
);
const externalRoutesPath = path.join(__dirname, '..', 'external', 'routes.js');

export const beforeRequest: (args: IBeforeHookRequest) => boolean =
  fs.existsSync(beforeHookPath) ? require(beforeHookPath) : () => true;

export const afterRequest: (args: IAfterHookResponse) => boolean =
  fs.existsSync(afterHookPath) ? require(afterHookPath) : () => true;

export const browserHook: (opts: IBrowserHook) => Promise<boolean> =
  fs.existsSync(browserSetupPath)
    ? require(browserSetupPath)
    : () => Promise.resolve(true);

export const pageHook: (opts: IPageHook) => Promise<boolean> = fs.existsSync(
  pageSetupPath,
)
  ? require(pageSetupPath)
  : () => Promise.resolve(true);

export const externalRoutes: Router | null = fs.existsSync(externalRoutesPath)
  ? require(externalRoutesPath)
  : null;

export const puppeteerHook: (
  args: ILaunchOptions,
) => Promise<typeof puppeteer | null> = fs.existsSync(puppeteerSetupPath)
  ? require(puppeteerSetupPath)
  : () => Promise.resolve(null);
