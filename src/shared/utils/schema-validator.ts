import Ajv, { ErrorObject, ValidateFunction } from 'ajv';

interface ValidateOptions {
  abortEarly?: boolean;
}

interface ValidationErrorDetail {
  message: string;
  context: { message: string; path: string };
  path: string[];
}

interface ValidationError {
  message: string;
  details: ValidationErrorDetail[];
}

interface ValidationResult<T = unknown> {
  value: T;
  error?: ValidationError;
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
});

const compiledCache = new WeakMap<object, ValidateFunction>();

const MAX_COERCE_DEPTH = 64;

const safeJsonParse = (text: string): unknown => {
  const reviver = (key: string, value: unknown): unknown => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return value;
  };
  return JSON.parse(text, reviver);
};

const derefSchema = (
  ref: string,
  root: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur as Record<string, unknown> | undefined;
};

/**
 * Returns the schema's unambiguous expected type, or undefined when the schema
 * is ambiguous (anyOf/oneOf with multiple non-null primitive alternatives).
 *
 * `null` is filtered out of `type: [...]` arrays so e.g. `"type":["string","null"]`
 * is treated as string-typed for coercion purposes.
 */
const inferExpectedType = (
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  seen: Set<string> = new Set(),
): string | undefined => {
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return undefined;
    seen.add(schema.$ref);
    const refSchema = derefSchema(schema.$ref, root);
    return refSchema ? inferExpectedType(refSchema, root, seen) : undefined;
  }
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) {
    const nonNull = (schema.type as unknown[]).filter(
      (t): t is string => typeof t === 'string' && t !== 'null',
    );
    if (nonNull.length === 1) return nonNull[0];
    return undefined;
  }
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return undefined;
};

const coerceStringToType = (
  value: string,
  expected: string,
): unknown | undefined => {
  if (expected === 'number' || expected === 'integer') {
    if (value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    if (expected === 'integer' && !Number.isInteger(n)) return undefined;
    return n;
  }
  if (expected === 'boolean') {
    if (value === 'true' || value === '') return true;
    if (value === 'false') return false;
    return undefined;
  }
  if (expected === 'object') {
    const t = value.trimStart();
    if (!t.startsWith('{')) return undefined;
    try {
      return safeJsonParse(value);
    } catch {
      return undefined;
    }
  }
  if (expected === 'array') {
    const t = value.trimStart();
    if (!t.startsWith('[')) return undefined;
    try {
      return safeJsonParse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

/**
 * Recursively coerces strings to their JSON-Schema-expected primitive types.
 * Mirrors joi+enjoi behavior:
 *   - string -> number/integer/boolean when schema is unambiguously numeric/boolean
 *   - string -> object/array via JSON.parse when schema is unambiguously object/array
 *   - never the reverse direction (number/object/etc. are returned untouched)
 *   - never coerces when the schema has anyOf/oneOf/multiple non-null types (matches joi's
 *     "first alternative wins" semantics where a string would match a string alternative)
 *
 * Inputs are never mutated; a new object/array is returned only when at least one
 * descendant value was actually coerced.
 */
const coerceAgainstSchema = (
  input: unknown,
  schema: Record<string, unknown> | undefined,
  root: Record<string, unknown>,
  depth: number,
  refStack: Set<string>,
): unknown => {
  if (depth > MAX_COERCE_DEPTH || !schema) return input;

  // Resolve $ref with cycle protection
  if (typeof schema.$ref === 'string') {
    if (refStack.has(schema.$ref)) return input;
    const target = derefSchema(schema.$ref, root);
    if (!target) return input;
    refStack.add(schema.$ref);
    const result = coerceAgainstSchema(input, target, root, depth + 1, refStack);
    refStack.delete(schema.$ref);
    return result;
  }

  // allOf: apply each subschema's coercion in order
  if (Array.isArray(schema.allOf)) {
    let v = input;
    for (const sub of schema.allOf as Record<string, unknown>[]) {
      v = coerceAgainstSchema(v, sub, root, depth + 1, refStack);
    }
    // Fall through so any type/properties on this schema also apply
    input = v;
  }

  // anyOf/oneOf: walk alternatives in DECLARED ORDER and pick the first that
  // accepts the input (with coercion if applicable). This mirrors joi's
  // `Joi.alternatives().try(...)` semantics where order matters:
  //   - `?launch={"headless":false}` against `[CDPLaunchOptions, string]` →
  //     object alt wins because the string JSON-parses successfully.
  //   - `?launch=eyJ...=` (base64 string, no `{`) against same → string alt wins.
  //   - `"5"` against `[number, string]` → number wins (convert coerces).
  //   - `"5"` against `[string, number]` → string wins (no need to convert).
  const alts =
    (schema.anyOf as Record<string, unknown>[] | undefined) ??
    (schema.oneOf as Record<string, unknown>[] | undefined);
  if (alts) {
    if (typeof input === 'string') {
      for (const alt of alts) {
        const t = inferExpectedType(alt, root);
        if (t === undefined || t === 'string' || t === 'null') {
          // String matches this alt as-is — stop, no coercion needed.
          return input;
        }
        const coerced = coerceStringToType(input, t);
        if (coerced !== undefined) {
          // Recurse so nested fields inside the coerced object/array also coerce.
          return coerceAgainstSchema(coerced, alt, root, depth + 1, refStack);
        }
      }
      return input;
    }
    if (Array.isArray(input)) {
      const arrayAlt = alts.find((a) => inferExpectedType(a, root) === 'array');
      if (arrayAlt) {
        return coerceAgainstSchema(input, arrayAlt, root, depth + 1, refStack);
      }
      return input;
    }
    if (input && typeof input === 'object') {
      const objAlt = alts.find((a) => inferExpectedType(a, root) === 'object');
      if (objAlt) {
        return coerceAgainstSchema(input, objAlt, root, depth + 1, refStack);
      }
      return input;
    }
    return input;
  }

  const expected = inferExpectedType(schema, root);

  if (typeof input === 'string') {
    if (!expected || expected === 'string' || expected === 'null') return input;
    const coerced = coerceStringToType(input, expected);
    return coerced !== undefined ? coerced : input;
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (expected && expected !== 'object') return input;
    const source = input as Record<string, unknown>;
    const props = schema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    const additional = schema.additionalProperties;
    const additionalSchema =
      additional && typeof additional === 'object' && !Array.isArray(additional)
        ? (additional as Record<string, unknown>)
        : undefined;

    let out: Record<string, unknown> = source;
    let cloned = false;
    for (const [key, value] of Object.entries(source)) {
      const propSchema = props?.[key] ?? additionalSchema;
      if (!propSchema) continue;
      const coerced = coerceAgainstSchema(
        value,
        propSchema,
        root,
        depth + 1,
        refStack,
      );
      if (coerced !== value) {
        if (!cloned) {
          out = { ...source };
          cloned = true;
        }
        out[key] = coerced;
      }
    }
    return out;
  }

  if (Array.isArray(input)) {
    if (expected && expected !== 'array') return input;
    const items = schema.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) return input;
    const itemSchema = items as Record<string, unknown>;
    let out: unknown[] = input;
    let cloned = false;
    for (let i = 0; i < input.length; i++) {
      const coerced = coerceAgainstSchema(
        input[i],
        itemSchema,
        root,
        depth + 1,
        refStack,
      );
      if (coerced !== input[i]) {
        if (!cloned) {
          out = input.slice();
          cloned = true;
        }
        out[i] = coerced;
      }
    }
    return out;
  }

  return input;
};

const formatErrors = (errors: ErrorObject[]): ValidationErrorDetail[] =>
  errors.map((err) => {
    const path = err.instancePath ? err.instancePath.split('/').filter(Boolean) : [];
    const message = err.message ?? 'validation failed';
    const labeled =
      err.instancePath && err.instancePath.length > 0
        ? `"${err.instancePath.replace(/^\//, '').replace(/\//g, '.')}" ${message}`
        : message;
    return {
      message: labeled,
      context: { message: labeled, path: err.instancePath ?? '' },
      path,
    };
  });

const getCompiled = (jsonSchema: object): ValidateFunction => {
  let validator = compiledCache.get(jsonSchema);
  if (validator) return validator;
  validator = ajv.compile(jsonSchema);
  compiledCache.set(jsonSchema, validator);
  return validator;
};

class CompiledSchema {
  private readonly validator: ValidateFunction;
  private readonly schema: Record<string, unknown>;

  constructor(jsonSchema: object) {
    this.validator = getCompiled(jsonSchema);
    this.schema = jsonSchema as Record<string, unknown>;
  }

  // _opts is accepted for joi API parity (e.g., { abortEarly }); ajv always returns all errors.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate<T = unknown>(input: unknown, _opts?: ValidateOptions): ValidationResult<T> {
    const coerced = coerceAgainstSchema(input, this.schema, this.schema, 0, new Set());
    const valid = this.validator(coerced);
    if (valid) {
      return { value: coerced as T };
    }
    const errs = this.validator.errors ?? [];
    const details = formatErrors(errs);
    return {
      value: coerced as T,
      error: {
        message: details.map((d) => d.message).join('; '),
        details,
      },
    };
  }
}

/**
 * Compile a JSON Schema (Draft-07) into a reusable validator.
 *
 * The returned `CompiledSchema` exposes `.validate(input, opts?)` returning
 * `{ value, error? }`. On failure, `error.details[]` mirrors joi's error
 * shape so call sites that previously used joi/enjoi continue to work.
 * Validators are compiled once per JSON Schema (cached by identity), making
 * this safe to call on every request without re-walking the schema.
 *
 * Recursive coercion (matches joi+enjoi semantics) is applied to the input
 * before validation:
 *   - string -> number/integer/boolean when schema is unambiguously numeric/boolean
 *   - string -> object/array via safe JSON.parse when schema is unambiguously
 *     object/array (proto-pollution keys are stripped)
 *   - never the reverse direction (non-strings are not converted)
 *   - never when the schema is ambiguous (multiple anyOf/oneOf alternatives
 *     including a string alternative)
 *
 * @param jsonSchema A JSON Schema (Draft-07)
 */
const compileSchema = (jsonSchema: object): CompiledSchema =>
  new CompiledSchema(jsonSchema);

export { CompiledSchema, compileSchema };
