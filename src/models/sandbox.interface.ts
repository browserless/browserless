export interface IConfig {
  code: string;
  timeout: number;
  useChromeStable: boolean;
  flags?: string[];
}

export interface IMessage {
  event: string;
  context: any;
}
