import { strict as assert } from 'node:assert';
import { readdir } from 'node:fs/promises';

// Image builds remove whole browser directories. A present browser must still
// provide both routes: missing modules or broken imports fail rather than skip.
const browsers = await readdir(new URL('../routes/', import.meta.url));

describe('BrowserQL route metadata', () => {
  for (const browser of browsers.filter((name) =>
    ['chromium', 'chrome', 'edge'].includes(name),
  )) {
    for (const file of ['http/bql.post.js', 'ws/bql.js']) {
      it(`${browser}/${file} supports no-argument documentation construction and retains admission controls`, async () => {
        const { default: Route } = await import(
          new URL(`../routes/${browser}/${file}`, import.meta.url).href
        );
        // Documentation generation constructs routes without application dependencies.
        const route = new Route();
        assert.deepEqual(route.path, [`/${browser}/bql?(/)`]);
        assert.equal(route.auth, true);
        assert.equal(route.concurrency, true);
        assert.equal(route.bypassLimits, undefined);
      });
    }
  }
});
