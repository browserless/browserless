import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

import { IncomingMessage, ServerResponse } from 'http';

import net from 'net';

import url from 'url';

import { Response } from 'express';
import { BrowserServer, LaunchOptions } from 'playwright-core';

import puppeteer from 'puppeteer';

export interface IChromeDriver {
  port: number;
  chromeProcess: ChildProcess;
  browser: IBrowser | null;
}

export interface IBrowser extends puppeteer.Browser {
  _isOpen: boolean;
  _isUsingTempDataDir: boolean;
  _keepalive: number | null;
  _keepaliveTimeout: NodeJS.Timeout | null;
  _parsed: url.UrlWithParsedQuery;
  _trackingId: string | null;
  _browserlessDataDir: string | null;
  _browserProcess: ChildProcess;
  _startTime: number;
  _id: string;
  _prebooted: boolean;
  _blockAds: boolean;
  _pauseOnConnect: boolean;
  _wsEndpoint: string;
  _browserServer: BrowserServer | puppeteer.Browser;
  _pages: puppeteer.Page[];
}

export interface IPage extends puppeteer.Page {
  _browserless_setup: boolean;
}

export interface ISession {
  description: string;
  devtoolsFrontendUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
  port: string;
  trackingId: string | null;
  browserWSEndpoint: string;
  browserId: string;
}

export interface IWindowSize {
  width: number;
  height: number;
}

export interface ILaunchOptions extends puppeteer.LaunchOptions {
  pauseOnConnect: boolean;
  blockAds: boolean;
  trackingId?: string;
  keepalive?: number;
  playwrightProxy?: LaunchOptions['proxy'];
  playwright: boolean;
  stealth: boolean;
  meta: unknown;
}

export interface IBefore {
  page: puppeteer.Page;
  browser: puppeteer.Browser;
  debug: (message: string) => void;
  jobId: string;
  code: string;
}

export interface IRunHTTP {
  code: any;
  context: any;
  req: any;
  res: any;
  detached?: boolean;
  before?: (params: IBefore) => Promise<any>;
  after?: (...args: any) => Promise<any>;
  flags?: string[];
  options?: any;
  headless?: boolean;
  ignoreDefaultArgs?: boolean | string[];
  builtin?: string[];
  envVars?: string[];
  external?: string[];
}

export interface IBrowserlessStats {
  date: number;
  successful: number;
  error: number;
  queued: number;
  rejected: number;
  unhealthy: number;
  memory: number | null;
  cpu: number | null;
  timedout: number;
  sessionTimes: number[];
  totalTime: number;
  meanTime: number;
  maxTime: number;
  minTime: number;
  maxConcurrent: number;
}

export interface ISandboxOpts {
  builtin: string[];
  external: boolean | string[];
  root: string;
  allowFileProtocol: boolean;
}

export interface IConfig {
  code: string;
  timeout: number;
  opts?: puppeteer.LaunchOptions;
  sandboxOpts: ISandboxOpts;
}

export interface IMessage {
  event: string;
  context?: any;
  error?: string;
}

export interface IBrowserlessOptions
  extends IBrowserlessServerConfiguration,
    IChromeServiceConfiguration {}

interface IBrowserlessServerConfiguration {
  host: string | undefined;
  port: number;
  token: string | null;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
  errorAlertURL: string | null;
  healthFailureURL: string | null;
  sessionCheckFailURL: string | null;
  metricsJSONPath: string | null;
  exitOnHealthFailure: boolean;
  workspaceDir: string;
  disabledFeatures: Feature[];
  enableAPIGet: boolean;
  socketBehavior: 'http' | 'close';
}

export interface IChromeServiceConfiguration {
  allowFileProtocol: boolean;
  connectionTimeout: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  functionExternals: string[];
  functionEnableIncognitoMode: boolean;
  functionBuiltIns: string[];
  functionEnvVars: string[];
  maxMemory: number;
  maxCPU: number;
  keepAlive: boolean;
  chromeRefreshTime: number;
  enableCors: boolean;
  singleRun: boolean;
  token: string | null;
}

export interface IAfter {
  downloadPath: string;
  page: puppeteer.Page;
  res: Response;
  done: (err?: Error) => any;
  debug: (message: string) => any;
  code: string;
  stopScreencast: () => void;
}

export type Feature =
  | 'prometheus'
  | 'debugger'
  | 'debugViewer'
  | 'introspectionEndpoint'
  | 'metricsEndpoint'
  | 'configEndpoint'
  | 'workspaces'
  | 'downloadEndpoint'
  | 'pressureEndpoint'
  | 'functionEndpoint'
  | 'killEndpoint'
  | 'screencastEndpoint'
  | 'screenshotEndpoint'
  | 'contentEndpoint'
  | 'pdfEndpoint'
  | 'statsEndpoint'
  | 'scrapeEndpoint';

export type consoleMethods = 'log' | 'warn' | 'debug' | 'table' | 'info';

export interface IResourceLoad {
  cpu: number | null;
  memory: number | null;
}

export interface IJob {
  (done?: IDone): any | Promise<any>;
  id?: string;
  browser?: IBrowser | null;
  close?: () => any;
  onTimeout?: () => any;
  start: number;
  req: IHTTPRequest | IWebdriverStartHTTP;
  timeout?: number | undefined;
}

export interface IQueue<IJob> extends EventEmitter, Array<IJob> {
  readonly concurrency: number;
  remove: (job: IJob) => any;
  add: (job: IJob) => any;
}

export type IDone = (error?: Error) => any;

export interface IQueueConfig {
  autostart: boolean;
  concurrency: number;
  maxQueueLength: number;
  timeout?: number;
}

export type IUpgradeHandler = (
  req: IncomingMessage,
  socket: net.Socket,
  head: Buffer,
) => Promise<any>;
export type IRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<any>;

export interface IWebDriverSession {
  browser: IBrowser | null;
  chromeDriver: ChildProcess;
  done: IDone;
  sessionId: string;
  proxy: any;
  res: ServerResponse;
}

interface IWebDriverSessions {
  [key: string]: IWebDriverSession;
}

export interface IHTTPRequest extends IncomingMessage {
  parsed: url.UrlWithParsedQuery;
}

export interface IHTTPRequestBody extends IncomingMessage {
  body: any;
}

export interface IWorkspaceItem {
  created: Date;
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  workspaceId: string | null;
}

export interface IWebdriverStartHTTP extends IHTTPRequest {
  body: any;
}

export interface IBrowserlessSessionOptions {
  token?: string;
  stealth: boolean;
  blockAds: boolean;
  trackingId: string | null;
  pauseOnConnect: boolean;
  windowSize?: IWindowSize;
  isUsingTempDataDir: boolean;
  browserlessDataDir: string | null;
}

export interface IWebdriverStartNormalized {
  body: any;
  params: IBrowserlessSessionOptions;
}

export interface IDevtoolsJSON {
  description: string;
  devtoolsFrontendUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface IBeforeHookRequest {
  req: IncomingMessage;
  res?: ServerResponse;
  socket?: net.Socket;
  head?: Buffer;
}

export interface IAfterHookResponse {
  req: IncomingMessage | IWebdriverStartHTTP;
  start: number;
  status: 'successful' | 'error' | 'timedout';
}

export interface IBrowserHook {
  browser: IBrowser;
  meta: unknown;
}

export interface IPageHook {
  page: puppeteer.Page;
  meta: unknown;
}
