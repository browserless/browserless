import {
  chromeExecutablePath,
  createLogger,
} from '@browserless.io/browserless';
import { ChromiumPlaywright } from './chromium.playwright.js';

export class ChromePlaywright extends ChromiumPlaywright {
  protected executablePath = chromeExecutablePath();
  protected debug = createLogger('browsers:chrome:playwright');
}
