import { LaunchOptions } from 'puppeteer';

export interface ISandboxOpts {
  builtin: string[];
  external: boolean | string[];
}
export interface IConfig {
  code: string;
  timeout: number;
  opts?: LaunchOptions;
  sandboxOpts: ISandboxOpts;
}

export interface IMessage {
  event: string;
  context?: any;
  error?: string;
}
