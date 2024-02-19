import {
  default as ChromiumPlaywrightWebSocketRoute,
  QuerySchema,
} from '../../../shared/playwright-chromium.ws.js';
import { ChromePlaywright } from '@browserless.io/browserless';

export default class ChromePlaywrightWebSocketRoute extends ChromiumPlaywrightWebSocketRoute {
  browser = ChromePlaywright;
}

export { QuerySchema };
