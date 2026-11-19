import {
  isBigIntObject,
  isBooleanObject,
  isNumberObject,
  isStringObject,
} from 'node:util/types';

type Token = string | { readonly quoted: string };

/** A snapshot of JSON semantics, retaining original strings rather than escaped copies. */
export interface PreparedJSON {
  readonly tokens: readonly Token[];
}

const nativeJSON = JSON as typeof JSON & {
  isRawJSON?: (value: unknown) => boolean;
};

/**
 * Resolve user code synchronously, before a transport commits any output.
 * Like JSON.stringify without a replacer; unsupported root values return undefined.
 * Memory is proportional to the result structure plus references to its strings.
 */
export function prepareJSON(
  value: unknown,
  indentation?: number | string,
): PreparedJSON | undefined {
  const gap =
    typeof indentation === 'string'
      ? indentation.slice(0, 10)
      : ' '.repeat(Math.min(10, Math.max(0, Math.trunc(indentation || 0))));
  const tokens: Token[] = [];
  const ancestors = new Set<object>();
  const stack: Array<{
    value: object;
    array: boolean;
    keys?: string[];
    length: number;
    index: number;
    count: number;
  }> = [];

  function visit(value: unknown, key: string): boolean {
    if (
      (value !== null &&
        (typeof value === 'object' || typeof value === 'function')) ||
      typeof value === 'bigint'
    ) {
      const toJSON = (value as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function')
        value = Reflect.apply(toJSON, value, [key]);
    }
    // Internal-slot checks work across realms and do not invoke proxy traps.
    if (isNumberObject(value)) value = +(value as number);
    else if (isStringObject(value)) value = String(value);
    else if (isBooleanObject(value))
      value = Boolean.prototype.valueOf.call(value);
    else if (isBigIntObject(value))
      value = BigInt.prototype.valueOf.call(value);

    if (typeof value === 'string') {
      tokens.push({ quoted: value });
      return true;
    }
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      tokens.push(JSON.stringify(value));
      return true;
    }
    if (typeof value === 'bigint') {
      throw new TypeError('Do not know how to serialize a BigInt');
    }
    if (typeof value !== 'object' || value === null) return false;
    if (nativeJSON.isRawJSON?.(value)) {
      tokens.push((value as { rawJSON: string }).rawJSON);
      return true;
    }
    if (ancestors.has(value))
      throw new TypeError('Converting circular structure to JSON');
    ancestors.add(value);
    const array = Array.isArray(value);
    tokens.push(array ? '[' : '{');
    // Array length and object keys are captured before visiting any children.
    const keys = array ? undefined : Object.keys(value);
    const length = array
      ? Math.min(
          Number.MAX_SAFE_INTEGER,
          Math.max(0, Math.floor(+(value as unknown[]).length) || 0),
        )
      : keys!.length;
    stack.push({ value, array, keys, length, index: 0, count: 0 });
    return true;
  }

  if (!visit(value, '')) return undefined;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.length) {
      stack.pop();
      if (frame.count && gap) tokens.push('\n', gap.repeat(stack.length));
      tokens.push(frame.array ? ']' : '}');
      ancestors.delete(frame.value);
      continue;
    }
    const key = frame.array ? String(frame.index) : frame.keys![frame.index];
    frame.index++;
    const start = tokens.length;
    if (frame.count) tokens.push(',');
    if (gap) tokens.push('\n', gap.repeat(stack.length));
    if (!frame.array) tokens.push({ quoted: key }, gap ? ': ' : ':');
    if (!visit((frame.value as Record<string, unknown>)[key], key)) {
      if (frame.array) tokens.push('null');
      else {
        tokens.length = start;
        continue;
      }
    }
    frame.count++;
  }
  return { tokens };
}

/** Emit at most 64 KiB per buffer; never create a whole escaped string/document. */
export function* jsonChunks(prepared: PreparedJSON): Generator<Buffer> {
  const capacity = 64 * 1024;
  let buffer = Buffer.allocUnsafe(capacity);
  let used = 0;

  function* pieces(): Generator<string> {
    for (const token of prepared.tokens) {
      const quoted = typeof token !== 'string';
      const text = quoted ? token.quoted : token;
      if (quoted) yield '"';
      for (let start = 0; start < text.length;) {
        let end = Math.min(start + 8192, text.length);
        // Never encode halves of a valid surrogate pair separately.
        const last = text.charCodeAt(end - 1);
        const next = text.charCodeAt(end);
        if (
          last >= 0xd800 &&
          last <= 0xdbff &&
          next >= 0xdc00 &&
          next <= 0xdfff
        )
          end--;
        const slice = text.slice(start, end);
        yield quoted ? JSON.stringify(slice).slice(1, -1) : slice;
        start = end;
      }
      if (quoted) yield '"';
    }
  }

  for (const piece of pieces()) {
    const bytes = Buffer.from(piece);
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(capacity - used, bytes.length - offset);
      bytes.copy(buffer, used, offset, offset + length);
      used += length;
      offset += length;
      if (used === capacity) {
        yield buffer;
        buffer = Buffer.allocUnsafe(capacity);
        used = 0;
      }
    }
  }
  if (used) yield buffer.subarray(0, used);
}
