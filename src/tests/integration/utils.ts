import { exec as execNode } from 'child_process';
import * as util from 'util';
import { IBrowserlessOptions } from '../../models/options.interface';

export const exec = util.promisify(execNode);

export const defaultParams: IBrowserlessOptions = {
  chromeRefreshTime: 0,
  connectionTimeout: 10000,
  demoMode: false,
  enableCors: false,
  enableDebugger: true,
  enableXvfb: 'CI' in process.env ? true : false,
  functionBuiltIns: ['url'],
  functionExternals: ['lighthouse'],
  healthFailureURL: null,
  host: '',
  keepAlive: false,
  maxCPU: 100,
  maxChromeRefreshRetries: 1,
  maxConcurrentSessions: 1,
  maxMemory: 100,
  maxQueueLength: 2,
  metricsJSONPath: null,
  port: 3000,
  prebootChrome: false,
  queuedAlertURL: null,
  rejectAlertURL: null,
  timeoutAlertURL: null,
  token: null,
};

export const throws = () => {
  throw new Error(`Should have thrown`);
};

export const getChromeProcesses = () => {
  return exec(`ps -ef | grep local-chromium`);
};

export const killChrome = () => {
  return exec(`pkill -f local-chromium`)
    .catch(() => {});
};

export const webdriverOpts = {
  args: [
    '--headless',
    '--no-sandbox',
  ],
};
