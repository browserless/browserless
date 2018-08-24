export interface IConfig {
  code: string;
  timeout: number;
  flags?: string[];
}

export interface IMessage {
  event: string;
  context?: any;
  error?: string;
}
