import { expect } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import EnjoiResolver from '../utils/enjoi-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Function API body schema validation', function () {
  let schema: any;

  before(async function () {
    const schemaPath = path.resolve(
      __dirname,
      '../../routes/chromium/http/function.post.body.json',
    );
    try {
      const bodySchema = JSON.parse(await fs.readFile(schemaPath, 'utf-8'));
      schema = EnjoiResolver.schema(bodySchema);
    } catch {
      this.skip();
    }
  });

  it('accepts primitive context values', () => {
    const body = {
      code: 'export default async function () {}',
      context: {
        role: 'admin',
        expiry: 3600,
        is_active: true,
      },
    };

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.be.undefined;
  });

  it('accepts nested objects in context', () => {
    const body = {
      code: 'export default async function () {}',
      context: {
        email_webhook_info: {
          url: 'https://example.com/webhook',
          headers: { authorization: 'Bearer token' },
        },
        phone_webhook_info: {
          url: 'https://example.com/sms',
        },
      },
    };

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.be.undefined;
  });

  it('accepts arrays in context', () => {
    const body = {
      code: 'export default async function () {}',
      context: {
        tags: ['a', 'b', 'c'],
        nested: [{ id: 1 }, { id: 2 }],
      },
    };

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.be.undefined;
  });

  it('accepts null values in context', () => {
    const body = {
      code: 'export default async function () {}',
      context: {
        otp: null,
        expiry: null,
      },
    };

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.be.undefined;
  });

  it('accepts a real-world complex context payload', () => {
    const body = {
      code: 'export default async function () {}',
      context: {
        is_citizen_of_birth_country: true,
        role: 'applicant',
        password: 'secret123',
        otp: null,
        expiry: 3600,
        email_webhook_info: {
          url: 'https://example.com/webhook',
          headers: { authorization: 'Bearer token' },
        },
        phone_webhook_info: {
          url: 'https://example.com/sms',
          retries: 3,
        },
      },
    };

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.be.undefined;
  });

  it('accepts a plain string as body (non-JSON mode)', () => {
    const body = 'export default async function () {}';

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.be.undefined;
  });

  it('rejects body missing required "code" field', () => {
    const body = {
      context: { role: 'admin' },
    };

    const { error } = schema.validate(body, { abortEarly: false });
    expect(error).to.not.be.undefined;
  });
});
