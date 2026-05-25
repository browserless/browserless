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
  // Single-browser docker images don't ship chromium route schemas;
  // skip the suite in that case so firefox/webkit/edge CI doesn't choke.
  before(async function () {
    try {
      await fs.access(path.join(routes, 'pdf.post.body.json'));
    } catch {
      this.skip();
    }
  });

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

  // Joi rejects empty strings for boolean fields; the prior implementation accidentally
  // coerced "" -> true. Lock the rejection in so the bug cannot regress.
  it('rejects empty string for a nested boolean field', async function () {
    const schema = compileSchema(await loadSchema('pdf.post.body.json'));
    const { error } = schema.validate({
      url: 'https://example.com/',
      options: { printBackground: '' },
    });
    expect(error).to.not.be.undefined;
  });

  // Top-level string -> object parse must then recurse so nested stringified
  // primitives (`"5000"` -> number, `"true"` -> boolean) coerce as joi did.
  it('recurses after parsing a JSON-string launch so nested fields coerce too', async function () {
    const querySchema = JSON.parse(
      await fs.readFile(path.join(routes, 'pdf.post.query.json'), 'utf-8'),
    );
    const schema = compileSchema(querySchema);
    const result = schema.validate({
      launch: '{"timeout":"5000","ignoreHTTPSErrors":"true","stealth":"false"}',
    });
    expect(result.error, result.error?.message).to.be.undefined;
    const v = result.value as {
      launch: { timeout: number; ignoreHTTPSErrors: boolean; stealth: boolean };
    };
    expect(v.launch.timeout).to.equal(5000);
    expect(v.launch.ignoreHTTPSErrors).to.equal(true);
    expect(v.launch.stealth).to.equal(false);
  });

  // Regression lock for #5384: a schema with `additionalProperties: {}` (the empty
  // schema, meaning "accept any value") must accept arbitrary values without warning
  // and without coercing them — empty `{}` carries no type info.
  it('accepts arbitrary values under additionalProperties: {} (issue #5384)', function () {
    const schema = compileSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: {},
      required: ['name'],
    });
    const input = {
      name: 'Alice',
      extra: { nested: [1, 'two', null, true] },
      stringified: '42',
    };
    const result = schema.validate(input);
    expect(result.error, result.error?.message).to.be.undefined;
    const v = result.value as Record<string, unknown>;
    // Empty schema = no coercion target, so values pass through untouched.
    expect(v.stringified).to.equal('42');
    expect(v.extra).to.deep.equal({ nested: [1, 'two', null, true] });
  });

  // Browserless route schemas set `additionalProperties: false` at the top level;
  // unknown keys must 400. Locks in the ajv config (removeAdditional stays off).
  it('rejects unknown top-level fields when additionalProperties is false', async function () {
    const schema = compileSchema(await loadSchema('pdf.post.body.json'));
    const { error } = schema.validate({ url: 'https://example.com/', bogus: 1 });
    expect(error).to.not.be.undefined;
  });

  // Proto-pollution safety: a JSON-string body with __proto__ must parse without
  // polluting Object.prototype, and the key must be silently dropped by the
  // reviver. This used to be Bourne's job; safeJsonParse takes over.
  it('strips __proto__/constructor keys when parsing a JSON-string body', async function () {
    const querySchema = JSON.parse(
      await fs.readFile(path.join(routes, 'pdf.post.query.json'), 'utf-8'),
    );
    const schema = compileSchema(querySchema);
    schema.validate({ launch: '{"__proto__":{"polluted":true},"headless":true}' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).to.equal(undefined);
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
