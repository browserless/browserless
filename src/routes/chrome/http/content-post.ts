import {
  BodySchema,
  default as Content,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/content.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromeContentRoute extends Content {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeContent];
}

export { BodySchema, QuerySchema, ResponseSchema };
