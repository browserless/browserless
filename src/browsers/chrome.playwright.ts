import { ChromiumPlaywright } from './chromium.playwright.js';
import { chromeExecutablePath } from '@browserless.io/browserless';

export class ChromePlaywright extends ChromiumPlaywright {
  protected executablePath = chromeExecutablePath;
}
