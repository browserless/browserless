import { expect } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { compileSchema } from '../utils/schema-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wsRoutes = path.resolve(__dirname, '../../routes/chromium/ws');

/**
 * The `launch` connection parameter is a passthrough to puppeteer.launch()
 * (CDP routes) / playwright.launchServer() (playwright routes): the parsed
 * object is spread straight to the launcher, which ignores keys it doesn't
 * recognize. `CDPLaunchOptions`/`BrowserServerOptions` only document a curated
 * subset of those launcher options, so the generated schema must NOT reject
 * unknown launch keys — otherwise a valid launcher option (or one added by a
 * downstream image) becomes a hard 400 instead of being forwarded.
 *
 * These tests lock that contract in: extra keys inside `launch` are accepted,
 * while malformed values for *known* launch fields and unknown *top-level*
 * query params are still rejected.
 */

const loadSchema = async (file: string) =>
  JSON.parse(await fs.readFile(path.join(wsRoutes, file), 'utf-8'));

describe('launch options passthrough', function () {
  // Single-browser docker images don't ship chromium route schemas; skip the
  // suite in that case so firefox/webkit/edge CI doesn't choke.
  before(async function () {
    try {
      await fs.access(path.join(wsRoutes, 'cdp.query.json'));
    } catch {
      this.skip();
    }
  });

  it('accepts unknown launcher options inside launch (CDP)', async function () {
    const schema = compileSchema(await loadSchema('cdp.query.json'));
    const { error } = schema.validate({
      token: 'token',
      launch: JSON.stringify({
        headless: true,
        args: ['--window-size=1920,1080'],
        // Real puppeteer.launch options outside the documented subset:
        executablePath: '/usr/bin/chromium',
        protocolTimeout: 60000,
        // An option a future/downstream build might honor:
        someUnknownLauncherOption: true,
      }),
    });
    expect(error, error?.message).to.be.undefined;
  });

  it('still rejects a malformed value for a known launch field (CDP)', async function () {
    const schema = compileSchema(await loadSchema('cdp.query.json'));
    const { error } = schema.validate({
      token: 'token',
      // `args` is typed string[]; a bare number is neither an array nor
      // coercible to one, so it must still fail.
      launch: JSON.stringify({ args: 123 }),
    });
    expect(error, 'expected a malformed known field to be rejected').to.not.be
      .undefined;
  });

  it('still rejects unknown top-level query params', async function () {
    const schema = compileSchema(await loadSchema('cdp.query.json'));
    const { error } = schema.validate({
      token: 'token',
      someUnknownTopLevelParam: 'true',
    });
    expect(error, 'expected an unknown top-level query param to be rejected').to
      .not.be.undefined;
  });

  it('accepts unknown launchServer options inside launch (Playwright)', async function () {
    try {
      await fs.access(path.join(wsRoutes, 'playwright.query.json'));
    } catch {
      this.skip();
    }
    const schema = compileSchema(await loadSchema('playwright.query.json'));
    const { error } = schema.validate({
      token: 'token',
      launch: JSON.stringify({
        headless: true,
        // Real playwright.launchServer options outside the documented subset:
        executablePath: '/usr/bin/chromium',
        slowMo: 50,
        someUnknownLauncherOption: true,
      }),
    });
    expect(error, error?.message).to.be.undefined;
  });
});
