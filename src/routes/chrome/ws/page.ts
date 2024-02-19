import { default as Page, QuerySchema } from '../../../shared/page.ws.js';
import { ChromeCDP } from '@browserless.io/browserless';

export default class ChromePage extends Page {
  browser = ChromeCDP;
}

export { QuerySchema };
