import {
  APITags,
  HTTPRoute,
  Methods,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';

export type ResponseSchema = string;

export default {
  accepts: [contentTypes.any],
  auth: true,
  browser: null,
  concurrency: false,
  contentTypes: [contentTypes.text],

  description: `Returns a simple "Hello World!" response. Useful for testing.`,
  handler: async (_req, res): Promise<void> => {
    const response: ResponseSchema = 'Hello World!';
    return writeResponse(res, 200, response, contentTypes.text);
  },
  method: Methods.get,
  path: '/hello',
  tags: [APITags.management],
} as HTTPRoute;
