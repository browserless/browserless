import { strict as assert } from 'node:assert';
import { constants } from 'node:buffer';
import { runInNewContext } from 'node:vm';
import { GraphQLError } from 'graphql';
import { jsonChunks, prepareJSON } from './json.js';

const encode = (value: unknown, indentation?: number | string) => {
  const prepared = prepareJSON(value, indentation);
  return prepared === undefined
    ? undefined
    : Buffer.concat([...jsonChunks(prepared)]).toString();
};

describe('bounded BQL JSON encoding', () => {
  it('matches native bytes for primitives, omissions, ordering and built-ins', () => {
    const shared = { value: 1 };
    const fixtures = [
      undefined,
      null,
      true,
      false,
      -0,
      NaN,
      Infinity,
      Symbol('x'),
      () => 1,
      { z: undefined, a: null, 10: 'ten', 2: 'two', f: () => 1, s: Symbol() },
      [undefined, , () => 1, Symbol(), NaN, -Infinity, shared, shared],
      { empty: {}, array: [], nested: [{ a: 'b' }] },
      new Date('2020-01-01'),
      new Date(NaN),
      Buffer.from([0, 255]),
      new GraphQLError('bad', { path: ['data', 2], extensions: { code: 'X' } }),
      new Error('ordinary'),
      Object(Symbol()),
      Object(2),
      Object('abc'),
      Object(false),
      runInNewContext(
        '({ n: new Number(2), s: new String("abc"), b: new Boolean(false) })',
      ),
    ];
    for (const fixture of fixtures) {
      for (const indentation of [
        undefined,
        2,
        20,
        -1,
        NaN,
        Infinity,
        2.9,
        '\t',
        'abcdefghijk',
      ]) {
        assert.equal(
          encode(fixture, indentation),
          JSON.stringify(fixture, null, indentation),
        );
      }
    }
  });

  it('matches native access order and toJSON keys without revisiting the source', () => {
    const make = (calls: string[]) => {
      const value: Record<string, unknown> = {
        get first() {
          calls.push('first');
          delete value.last;
          value.added = 'not visited';
          return {
            toJSON(key: string) {
              calls.push(`json:${key}`);
              return 'changed';
            },
          };
        },
        child: null,
        last: 'deleted',
      };
      const child = {
        toJSON(key: string) {
          calls.push(`json:${key}:${this === child}`);
          return [1, undefined];
        },
      };
      value.child = child;
      return value;
    };
    const nativeCalls: string[] = [];
    const expected = JSON.stringify(make(nativeCalls));
    const calls: string[] = [];
    const value = make(calls);
    const prepared = prepareJSON(value)!;
    assert.deepEqual(calls, nativeCalls);
    value.child = 'mutated after preparation';
    assert.equal(Buffer.concat([...jsonChunks(prepared)]).toString(), expected);
    assert.deepEqual(calls, nativeCalls);
  });

  it('honors root/function toJSON, inherited array indices and array length snapshots', () => {
    const fn = Object.assign(() => 0, { toJSON: (key: string) => ({ key }) });
    assert.equal(encode(fn), JSON.stringify(fn));
    const make = () => {
      const array = [0, , 2];
      Object.setPrototypeOf(
        array,
        Object.assign(Object.create(Array.prototype), { 1: 'inherited' }),
      );
      Object.defineProperty(array, 0, {
        get() {
          array.push(3);
          return 0;
        },
      });
      return array;
    };
    assert.equal(encode(make()), JSON.stringify(make()));
    const boxed = Object(2);
    boxed[Symbol.toPrimitive] = () => 42;
    assert.equal(encode(boxed), JSON.stringify(boxed));
    assert.equal(encode({ toJSON: () => undefined }), undefined);
  });

  it('throws during preparation for cycles, BigInt and throwing user code', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [cycle, { a: 1n }, Object(1n)]) {
      assert.throws(() => prepareJSON(value), TypeError);
    }
    const error = new Error('user code');
    for (const value of [
      {
        good: 'first',
        get bad() {
          throw error;
        },
      },
      {
        good: 'first',
        bad: {
          toJSON() {
            throw error;
          },
        },
      },
    ])
      assert.throws(
        () => prepareJSON(value),
        (actual) => actual === error,
      );
    const value = Object.assign(Object(1n), { toJSON: () => 'big' });
    assert.equal(encode(value), JSON.stringify(value));
  });

  it('preserves escaping and surrogate pairs across chunk boundaries', () => {
    const controls = Array.from({ length: 32 }, (_, i) =>
      String.fromCharCode(i),
    ).join('');
    for (const offset of [0, 1, 2, 16383, 16384, 16385, 65535, 65536]) {
      const text =
        'x'.repeat(offset) +
        '😀' +
        '\ud800' +
        'a' +
        '\udfff' +
        '"\\\n' +
        controls +
        'é漢';
      const value = { [text]: text };
      assert.equal(encode(value), JSON.stringify(value));
    }
  });

  it('emits bounded buffers for large escape-heavy strings', () => {
    const value = { body: '\u0000😀"\\'.repeat(200_000) };
    const chunks = [...jsonChunks(prepareJSON(value)!)];
    assert.ok(chunks.length > 10);
    assert.ok(
      chunks.every(
        (chunk) =>
          Buffer.isBuffer(chunk) && chunk.length > 0 && chunk.length <= 65536,
      ),
    );
    assert.equal(Buffer.concat(chunks).toString(), JSON.stringify(value));
  });

  it('emits an aggregate larger than V8 permits in one string', () => {
    // Share the input string deliberately: this isolates encoding, not body collection.
    const body = 'x'.repeat(19 * 1024 * 1024);
    const value = Array.from({ length: 30 }, () => body);
    let bytes = 0;
    for (const chunk of jsonChunks(prepareJSON(value)!)) {
      assert.ok(chunk.length <= 65536);
      bytes += chunk.length;
    }
    assert.equal(bytes, 30 * body.length + 30 * 2 + 29 + 2);
    assert.ok(bytes > constants.MAX_STRING_LENGTH);
  });

  it('preserves UTF-8 bytes for indentation containing lone surrogates', () => {
    const value = { outer: { inner: ['text'] } };
    for (const indentation of ['\ud800', '\udc00x\ud800', '123456789😀']) {
      assert.deepEqual(
        Buffer.concat([...jsonChunks(prepareJSON(value, indentation)!)]),
        Buffer.from(JSON.stringify(value, null, indentation)),
      );
    }
  });

  it('prepares deeply nested results without consuming the JavaScript call stack', () => {
    let value: unknown = 0;
    for (let i = 0; i < 5000; i++) value = [value];
    assert.equal(encode(value), '['.repeat(5000) + '0' + ']'.repeat(5000));
  });

  it('preserves native raw JSON when available', () => {
    const native = JSON as typeof JSON & {
      rawJSON?: (text: string) => unknown;
    };
    if (!native.rawJSON) return;
    const value = {
      n: native.rawJSON('12345678901234567890'),
      s: native.rawJSON('"\\u0061"'),
    };
    assert.equal(encode(value, 2), JSON.stringify(value, null, 2));
  });

  it('invokes toJSON through its call slot, not a user-defined call property', () => {
    const toJSON = Object.assign(
      function (key: string) {
        return { key };
      },
      {
        call() {
          throw new Error('not a method invocation');
        },
      },
    );
    assert.equal(encode({ a: { toJSON } }), JSON.stringify({ a: { toJSON } }));
  });

  it('does not invoke BigInt toJSON again on an already transformed value', () => {
    const prototype = BigInt.prototype as unknown as { toJSON?: () => unknown };
    const previous = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    let calls = 0;
    Object.defineProperty(prototype, 'toJSON', {
      configurable: true,
      value() {
        calls++;
        return calls === 1 ? 1n : 'second call';
      },
    });
    try {
      assert.throws(() => JSON.stringify(1n), TypeError);
      calls = 0;
      assert.throws(() => prepareJSON(1n), TypeError);
      assert.equal(calls, 1);
    } finally {
      if (previous) Object.defineProperty(prototype, 'toJSON', previous);
      else delete prototype.toJSON;
    }
  });
});
