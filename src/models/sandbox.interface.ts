import { LaunchOptions } from 'puppeteer';

export interface IConfig {
  code: string;
  timeout: number;
  opts?: LaunchOptions;
}

export interface IMessage {
  event: string;
  context?: any;
  error?: string;
}
