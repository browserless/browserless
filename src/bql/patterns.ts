import { BadRequest } from '@browserless.io/browserless';
import { RE2JS } from 're2js';
import micromatch from 'micromatch';

export function compileRegex(pattern: string, flags = 0): RE2JS {
  if (pattern.length > 200) throw new BadRequest('Regex is too long');
  try {
    return RE2JS.compile(pattern, flags);
  } catch {
    throw new BadRequest('Regex is invalid or unsupported');
  }
}

const globs = new Map<
  string,
  { regex: RE2JS; negate: boolean; excludeDotSegments: boolean }
>();

// RE2 counts code points; legacy globs count UTF-16 code units. Represent each
// surrogate separately in a reserved BMP range, preserving code-unit ordering.
function encodeSurrogates(value: string): string {
  return value.replace(/[\uD800-\uDFFF]/g, (unit) =>
    String.fromCharCode(unit.charCodeAt(0) + 0x800),
  );
}

/** Compile legacy globs to RE2; reject syntax requiring unsupported assertions. */
export function matchesGlob(value: string, pattern: string): boolean {
  if (pattern.length > 200) throw new BadRequest('Glob is too long');
  if (/[\uE000-\uE7FF]/.test(pattern) || /[\uE000-\uE7FF]/.test(value))
    throw new BadRequest(
      'Glob is invalid or unsupported: reserved private-use characters',
    );
  let compiled = globs.get(pattern);
  if (!compiled) {
    try {
      const negations = /^!+(?!\()/.exec(pattern)?.[0].length ?? 0;
      const positive = encodeSurrogates(pattern.slice(negations));
      // Keep unsupported normalization explicit rather than matching literally.
      if (/[\\"]/.test(pattern) || pattern.startsWith('./')) throw new Error();
      let source = micromatch.makeRe(positive, {
        bash: true,
        strictBrackets: true,
        fastpaths: negations === 0,
      }).source;
      // micromatch uses this sentinel when its generated regex is invalid.
      // Negating it would otherwise turn an invalid range into match-all.
      if (source === '$^') throw new Error();
      // Non-ASCII identity escapes are literals in JavaScript but invalid in
      // RE2. Leave ASCII escapes (including regex metacharacters) untouched.
      source = source.replace(/\\([\u0080-\uFFFF])/g, '$1');
      // micromatch's literal-prefix fastpath excludes dotted path segments
      // throughout its stars. Enforce that with a linear string check only
      // for picomatch's literal-prefix fastpath (which has no literal slash).
      const dotSegments = '(?:(?:(?!(?:^|\\/)\\.).)*?)';
      const excludeDotSegments = source.includes(dotSegments);
      if (excludeDotSegments) {
        if (/(^[*!?]|[/()[\]{}"\\]|\*\*)/.test(positive)) throw new Error();
        source = source.replaceAll(dotSegments, '.*?');
      }
      source = source.replaceAll('(?=.)(?!\\.)', '(?!\\.)(?=.)');
      source = source.replaceAll('(?!\\.)(?=.).*?', '[^.].*?');
      // A final star with a nonempty assertion (as in *.*) must consume
      // something, including a trailing slash that micromatch permits.
      source = source.replace('(?=.).*?\\/?)$', '.+?\\/?)$');
      source = source.replaceAll('(?!\\.).*?', (assertion, offset) => {
        const next = source.slice(offset + assertion.length);
        // A star at a segment boundary cannot consume a leading dot. If the
        // next literal is itself a dot, the star must consume at least one
        // character. Otherwise its empty branch is safe only for these tokens.
        if (next.startsWith('\\.')) return '[^.].*?';
        if (/^(?:\\[^\w]|[^\[().*+?^|\\])/.test(next)) return '(?:[^.].*?)?';
        throw new Error();
      });
      compiled = {
        regex: RE2JS.compile(source),
        negate: negations % 2 === 1,
        excludeDotSegments,
      };
    } catch {
      throw new BadRequest('Glob is invalid or unsupported');
    }
    if (globs.size >= 128) globs.delete(globs.keys().next().value!);
    globs.set(pattern, compiled);
  }
  if (value === '') return false;
  if (value === pattern) return true;
  if (/[\n\r\u2028\u2029]/.test(value))
    throw new BadRequest('Glob is invalid or unsupported for this value');
  const matched =
    !(compiled.excludeDotSegments && value.includes('/.')) &&
    compiled.regex.test(encodeSurrogates(value));
  return compiled.negate ? !matched : matched;
}
