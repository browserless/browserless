import {
  APITags,
  HTTPRoute,
  Methods,
  Request,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

// An `auth = false` HTTP route, as SDK consumers may add, used by
// strict-token.spec.ts to prove STRICT_TOKEN_USE gates HTTP routes too.
export default class StrictTokenFixtureRoute extends HTTPRoute {
  name = 'StrictTokenFixtureRoute';
  accepts = [contentTypes.any];
  auth = false;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.text];
  description = 'Test fixture: a public HTTP route.';
  method = Methods.get;
  path = '/strict-token-fixture';
  tags = [APITags.management];
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    return writeResponse(res, 200, 'ok');
  }
}
