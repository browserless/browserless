import { default as Browser, QuerySchema } from '../../../shared/browser.ws.js';
import { ChromeCDP } from '@browserless.io/browserless';

export default class ChromeBrowser extends Browser {
  browser = ChromeCDP;
}

export { QuerySchema };
