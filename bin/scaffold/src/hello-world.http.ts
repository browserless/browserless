import {
  APITags,
  HTTPRoute,
  Logger,
  Methods,
  Request,
  Response,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';

export type ResponseSchema = string;

export default class HelloWorldHTTPRoute extends HTTPRoute {
  name = 'HelloWorldHTTPRoute';
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.text];
  description = `Returns a simple "Hello World!" response. Useful for testing.`;
  method = Methods.get;
  path = '/hello';
  tags = [APITags.management];
  async handler(req: Request, res: Response, logger: Logger): Promise<void> {
    logger.debug(`${req.method} /hello was called!`);
    const response: ResponseSchema = 'Hello World!';
    return writeResponse(res, 200, response, contentTypes.text);
  }
}
