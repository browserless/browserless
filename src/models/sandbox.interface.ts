export interface IConfig {
  code: string;
  timeout: number;
  chromeBinaryPath: string;
  flags?: string[];
}

export interface IMessage {
  event: string;
  context?: any;
  error?: string;
}
