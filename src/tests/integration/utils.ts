import { exec as execNode } from 'child_process';
import _ from 'lodash';
import os from 'os';
import util from 'util';
import { IBrowserlessOptions } from '../../types';

export const exec = util.promisify(execNode);
export const getPort = () => 3000 + +_.uniqueId();
export const defaultParams = (): IBrowserlessOptions => ({
  allowFileProtocol: false,
  chromeRefreshTime: 0,
  connectionTimeout: 10000,
  disabledFeatures: [],
  enableAPIGet: true,
  enableCors: false,
  enableHeapdump: false,
  errorAlertURL: null,
  exitOnHealthFailure: false,
  functionBuiltIns: ['url'],
  functionEnableIncognitoMode: false,
  functionExternals: ['lighthouse'],
  healthFailureURL: null,
  host: '',
  keepAlive: false,
  maxCPU: 100,
  maxConcurrentSessions: 1,
  maxMemory: 100,
  maxQueueLength: 2,
  metricsJSONPath: null,
  port: getPort(),
  prebootChrome: false,
  queuedAlertURL: null,
  rejectAlertURL: null,
  sessionCheckFailURL: null,
  singleRun: false,
  timeoutAlertURL: null,
  token: null,
  workspaceDir: os.tmpdir(),
  socketBehavior: 'http',
});

export const throws = () => {
  throw new Error(`Should have thrown`);
};

export const getChromeProcesses = () => {
  return exec(`ps -ef | grep local-chromium`);
};

export const killChrome = () => {
  return exec(`pkill -f local-chromium`).catch(() => {});
};

export const webdriverOpts = {
  args: ['--headless', '--no-sandbox'],
};
