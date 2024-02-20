import {
  BodySchema,
  default as Function,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/function.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromeFunctionRoute extends Function {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeFunction];
}

export { BodySchema, QuerySchema, ResponseSchema };
