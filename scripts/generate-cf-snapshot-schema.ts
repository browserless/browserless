/**
 * Generate Draft-07 JSON Schema from Effect Schema definition.
 *
 * Replaces the old json-schema-to-typescript (json2ts) codegen pipeline:
 *   Before: hand-edit JSON Schema → json2ts → generated.ts
 *   After:  Effect Schema (cloudflare-detection.ts) → this script → JSON Schema
 *
 * The generated JSON Schema feeds datamodel-codegen for the Python Pydantic model.
 *
 * Usage: npm run schema:generate
 */
import { JsonSchema, Schema } from 'effect';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { CloudflareSnapshot } from '../src/shared/cloudflare-detection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Generate Draft-2020-12, then convert to Draft-07 for Python compatibility
const doc = Schema.toJsonSchemaDocument(CloudflareSnapshot);
const draft07 = JsonSchema.toDocumentDraft07(doc);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Inline $ref definitions — the original hand-written schema didn't use $ref,
 * and inlining keeps the output clean for datamodel-codegen.
 */
function inlineRefs(obj: JsonValue, defs: Record<string, JsonValue>): JsonValue {
  if (!obj || typeof obj !== 'object') return obj;
  if (!Array.isArray(obj) && '$ref' in obj && typeof obj['$ref'] === 'string') {
    const defName = (obj['$ref'] as string).replace('#/definitions/', '');
    return defs[defName] ? { ...(defs[defName] as Record<string, JsonValue>) } : obj;
  }
  if (Array.isArray(obj)) return obj.map((v) => inlineRefs(v, defs));
  const result: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = inlineRefs(v, defs);
  }
  return result;
}

/**
 * Flatten single-element allOf wrappers.
 *
 * Effect v4 wraps annotations on piped schemas in allOf:
 *   { "type": "integer", "allOf": [{ "description": "...", "default": 0 }] }
 *
 * This is valid JSON Schema but verbose. Flatten to:
 *   { "type": "integer", "description": "...", "default": 0 }
 */
function flattenAllOf(obj: JsonValue): JsonValue {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(flattenAllOf);

  const result: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'allOf' && Array.isArray(v) && v.length === 1 && typeof v[0] === 'object' && v[0] !== null) {
      Object.assign(result, flattenAllOf(v[0]));
    } else {
      result[k] = flattenAllOf(v);
    }
  }
  return result;
}

const schema = flattenAllOf(
  inlineRefs(draft07.schema as JsonValue, (draft07.definitions ?? {}) as Record<string, JsonValue>),
) as Record<string, JsonValue>;

const output: Record<string, JsonValue> = {
  $schema: 'https://json-schema.org/draft-07/schema#',
  $id: 'CloudflareSnapshot',
  title: 'CloudflareSnapshot',
  description:
    'Accumulated state for one CF solve phase, included in solved/failed events. Generated from Effect Schema in cloudflare-detection.ts.',
  ...schema,
};

delete output.definitions;

const outPath = path.join(rootDir, 'src', 'shared', 'cloudflare-snapshot.schema.json');
await fs.writeFile(outPath, JSON.stringify(output, null, 2) + '\n');
console.log('Generated cloudflare-snapshot.schema.json from Effect Schema');
