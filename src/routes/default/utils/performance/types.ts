import { Config, Flags } from 'lighthouse';
import { BrowserInstance } from 'src/types.js';

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
  timeout: number;
}

export interface start {
  config?: Config;
  options?: Flags;
  url: string;
}
