import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Screenshot,
} from '../../../shared/screenshot.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromeScreenshot extends Screenshot {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScreenshot];
}

export { BodySchema, QuerySchema, ResponseSchema };
