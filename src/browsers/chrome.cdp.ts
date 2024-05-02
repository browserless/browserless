import {
  Logger,
  chromeExecutablePath,
} from '@browserless.io/browserless';
import { ChromiumCDP } from './chromium.cdp.js';

export class ChromeCDP extends ChromiumCDP {
  protected executablePath = chromeExecutablePath();
  protected logger = new Logger('browsers:chrome:cdp');
}
