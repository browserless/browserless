import {
  Logger,
  chromeExecutablePath,
} from '@browserless.io/browserless';
import { ChromiumPlaywright } from './chromium.playwright.js';

export class ChromePlaywright extends ChromiumPlaywright {
  protected executablePath = chromeExecutablePath();
  protected logger = new Logger('browsers:chrome:playwright');
}
