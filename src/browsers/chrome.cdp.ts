import {
  chromeExecutablePath,
  createLogger,
} from '@browserless.io/browserless';
import { ChromiumCDP } from './chromium.cdp.js';

export class ChromeCDP extends ChromiumCDP {
  protected executablePath = chromeExecutablePath;
  protected debug = createLogger('browsers:chrome:cdp');
}
