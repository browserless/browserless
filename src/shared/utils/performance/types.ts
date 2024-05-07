import { BrowserInstance, Logger } from '@browserless.io/browserless';
import { Config, Flags } from 'lighthouse';

export interface Message {
  data?: unknown;
  error?: unknown;
  event: string;
}

export interface mainOptions {
  browser: BrowserInstance;
  context: {
    budgets?: Array<unknown>;
    config?: unknown;
    url: string;
  };
  logger: Logger;
  timeout: number;
}

export interface start {
  config?: Config;
  options?: Flags;
  url: string;
}
