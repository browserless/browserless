import { strict as assert } from 'node:assert';
import ChromiumHTTP from '../routes/chromium/http/bql.post.js';
import ChromeHTTP from '../routes/chrome/http/bql.post.js';
import EdgeHTTP from '../routes/edge/http/bql.post.js';
import ChromiumWS from '../routes/chromium/ws/bql.js';
import ChromeWS from '../routes/chrome/ws/bql.js';
import EdgeWS from '../routes/edge/ws/bql.js';

describe('BrowserQL route metadata', () => {
  for (const [Route, path] of [
    [ChromiumHTTP, '/chromium/bql'],
    [ChromeHTTP, '/chrome/bql'],
    [EdgeHTTP, '/edge/bql'],
    [ChromiumWS, '/chromium/bql'],
    [ChromeWS, '/chrome/bql'],
    [EdgeWS, '/edge/bql'],
  ] as const) {
    it(`${Route.name} supports no-argument documentation construction and retains admission controls`, () => {
      // Documentation generation constructs routes without application dependencies.
      const route = new (
        Route as unknown as new () => InstanceType<typeof Route>
      )();
      assert.deepEqual(route.path, [path]);
      assert.equal(route.auth, true);
      assert.equal(route.concurrency, true);
      assert.equal(route.bypassLimits, undefined);
    });
  }
});
