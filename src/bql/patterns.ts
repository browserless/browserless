import { BadRequest } from '@browserless.io/browserless';
import { RE2JS } from 're2js';

export function compileRegex(pattern: string, flags = 0): RE2JS {
  if (pattern.length > 200) throw new BadRequest('Regex is too long');
  try {
    return RE2JS.compile(pattern, flags);
  } catch {
    throw new BadRequest('Regex is invalid or unsupported');
  }
}

const globs = new Map<string, RE2JS>();

/** URL/title wildcards: * matches any sequence, ? matches one character. */
export function matchesGlob(value: string, pattern: string): boolean {
  if (pattern.length > 200) throw new BadRequest('Glob is too long');
  let compiled = globs.get(pattern);
  if (!compiled) {
    const source = [...pattern]
      .map((char) =>
        char === '*' ? '.*' : char === '?' ? '.' : RE2JS.quote(char),
      )
      .join('');
    compiled = RE2JS.compile(`^(?:${source})$`, RE2JS.DOTALL);
    if (globs.size >= 128) globs.delete(globs.keys().next().value!);
    globs.set(pattern, compiled);
  }
  return compiled.test(value);
}
