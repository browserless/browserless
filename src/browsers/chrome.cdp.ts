import { ChromiumCDP } from './chromium.cdp.js';
import { chromeExecutablePath } from '@browserless.io/browserless';

export class ChromeCDP extends ChromiumCDP {
  protected executablePath = chromeExecutablePath;
}
