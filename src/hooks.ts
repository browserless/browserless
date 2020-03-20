import { Router } from 'express';
import * as fs from 'fs';
import * as http from 'http';
import { Socket } from 'net';
import * as path from 'path';
import { Page } from 'puppeteer';

import {
  IBrowser,
  IWebdriverStartHTTP,
  IHTTPRequest,
} from './types';

const beforeHookPath = path.join(__dirname, '..', 'external', 'before.js');
const afterHookPath = path.join(__dirname, '..', 'external', 'after.js');
const browserSetupPath = path.join(__dirname, '..', 'external', 'browser.js');
const pageSetupPath = path.join(__dirname, '..', 'external', 'page.js');
const externalRoutesPath = path.join(__dirname, '..', 'external', 'routes.js');

export const beforeRequest: (args: {
  req: IHTTPRequest;
  res?: http.ServerResponse;
  socket?: Socket;
  head?: Buffer;
}) => boolean =
  fs.existsSync(beforeHookPath) ?
    require(beforeHookPath) :
    () => true;

export const afterRequest: (args: {
  req: IHTTPRequest | IWebdriverStartHTTP;
  start: number;
  status: string;
}) => boolean = fs.existsSync(afterHookPath) ?
  require(afterHookPath) :
  () => true;

export const browserHook: (opts: { browser: IBrowser }) => Promise<boolean> = fs.existsSync(browserSetupPath) ?
  require(browserSetupPath) :
  () => Promise.resolve(true);

export const pageHook: (opts: { page: Page }) => Promise<boolean> = fs.existsSync(pageSetupPath) ?
  require(pageSetupPath) :
  () => Promise.resolve(true);

export const externalRoutes: Router | null = fs.existsSync(externalRoutesPath) ?
  require(externalRoutesPath) :
  null;
