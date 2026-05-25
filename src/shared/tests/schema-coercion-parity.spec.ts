import { expect } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { compileSchema } from '../utils/schema-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routes = path.resolve(__dirname, '../../routes/chromium/http');

/**
 * Locks in the coercion contract that matches joi+enjoi (the previous validator).
 *
 * Bodies in this file mirror the canonical curl/Python examples on
 * docs.browserless.io. If any of these change behavior, real client traffic
 * will too — keep them green.
 */

const loadSchema = async (file: string) =>
  JSON.parse(await fs.readFile(path.join(routes, file), 'utf-8'));

describe('Schema coercion parity (joi+enjoi → ajv)', function () {
  // Source: https://docs.browserless.io/http-apis/pdf — curl example
  it('accepts the documented /pdf body', async function () {
    const schema = compileSchema(await loadSchema('pdf.post.body.json'));
    const { error } = schema.validate({
      url: 'https://example.com/',
      options: { displayHeaderFooter: true, printBackground: false, format: 'A0' },
    });
    expect(error, error?.message).to.be.undefined;
  });

  // Locks in joi convert:true behavior on nested boolean fields.
  // A sloppy client may send `"true"`/`"false"` as strings; joi coerced them silently.
  it('coerces stringified booleans nested inside /pdf options', async function () {
    const schema = compileSchema(await loadSchema('pdf.post.body.json'));
    const result = schema.validate({
      url: 'https://example.com/',
      options: { displayHeaderFooter: 'true', printBackground: 'false', format: 'A0' },
    });
    expect(result.error, result.error?.message).to.be.undefined;
    const v = result.value as { options: { displayHeaderFooter: boolean; printBackground: boolean } };
    expect(v.options.displayHeaderFooter).to.equal(true);
    expect(v.options.printBackground).to.equal(false);
  });

  // Source: https://docs.browserless.io/http-apis/screenshot — curl example
  it('accepts the documented /screenshot body', async function () {
    const schema = compileSchema(await loadSchema('screenshot.post.body.json'));
    const { error } = schema.validate({
      url: 'https://example.com/',
      options: { fullPage: true, type: 'png' },
    });
    expect(error, error?.message).to.be.undefined;
  });

  // gotoOptions.waitUntil is a puppeteer enum surfaced in /content; locks in
  // that nested enum validation flows correctly through the resolver.
  it('accepts a nested enum (gotoOptions.waitUntil)', async function () {
    const schema = compileSchema(await loadSchema('content.post.body.json'));
    const { error } = schema.validate({
      url: 'https://example.com/',
      gotoOptions: { waitUntil: 'networkidle0' },
    });
    expect(error, error?.message).to.be.undefined;
  });

  // Source: https://docs.browserless.io/http-apis/function — Quotes To Scrape example.
  // Locks in joi's "string alternative wins" anyOf semantics: ContextValue is
  // anyOf<array|object|null|string|number|boolean>. A stringified number stays a string.
  it('keeps stringified context values as strings (anyOf string-alt-wins)', async function () {
    const schema = compileSchema(await loadSchema('function.post.body.json'));
    const result = schema.validate({
      code: 'export default async () => ({ data: "ok", type: "text/plain" })',
      context: { pageNumber: '2', maxQuotes: '3' },
    });
    expect(result.error, result.error?.message).to.be.undefined;
    const v = result.value as { context: { pageNumber: unknown; maxQuotes: unknown } };
    expect(v.context.pageNumber).to.equal('2');
    expect(v.context.maxQuotes).to.equal('3');
  });

  // Source: https://docs.browserless.io/http-apis/scrape — array of selectors
  it('accepts the documented /scrape body (array of element selectors)', async function () {
    const schema = compileSchema(await loadSchema('scrape.post.body.json'));
    const { error } = schema.validate({
      url: 'https://browserless.io/',
      elements: [{ selector: 'h1' }],
    });
    expect(error, error?.message).to.be.undefined;
  });

  // The `launch` query param appears on essentially every browser route; clients send it
  // either as a JSON object (`?launch={...}`) or as a base64-encoded JSON string. The
  // schema is `anyOf<CDPLaunchOptions, string>` and joi+enjoi parsed JSON-looking strings
  // into objects so the `CDPLaunchOptions` alt could match. Lock that behavior in.
  it('parses JSON-shaped launch query into an object (anyOf object-alt wins via coerce)', async function () {
    const querySchema = JSON.parse(
      await fs.readFile(path.join(routes, 'pdf.post.query.json'), 'utf-8'),
    );
    const schema = compileSchema(querySchema);
    const result = schema.validate({ launch: '{"headless":false,"args":["--no-sandbox"]}' });
    expect(result.error, result.error?.message).to.be.undefined;
    const v = result.value as { launch: { headless: boolean; args: string[] } };
    expect(v.launch).to.deep.equal({ headless: false, args: ['--no-sandbox'] });
  });

  it('leaves base64-encoded launch as a string (no leading `{` means no coerce)', async function () {
    const querySchema = JSON.parse(
      await fs.readFile(path.join(routes, 'pdf.post.query.json'), 'utf-8'),
    );
    const schema = compileSchema(querySchema);
    const encoded = Buffer.from('{"headless":true}').toString('base64');
    const result = schema.validate({ launch: encoded });
    expect(result.error, result.error?.message).to.be.undefined;
    const v = result.value as { launch: string };
    expect(v.launch).to.equal(encoded);
  });

  // Negative case — guarantees coercion does not silently accept un-coercible garbage.
  it('rejects un-coercible nested values', async function () {
    const schema = compileSchema(await loadSchema('pdf.post.body.json'));
    const { error } = schema.validate({
      url: 'https://example.com/',
      viewport: {
        width: 'not-a-number',
        height: 100,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: false,
      },
    });
    expect(error).to.not.be.undefined;
  });
});
