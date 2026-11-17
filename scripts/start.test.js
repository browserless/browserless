import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

for (const script of ['start.sh', 'test.sh']) {
  test(`${script} keeps the display alive and preserves diagnostics`, async () => {
    const source = await readFile(new URL(script, import.meta.url), 'utf8');
    const command = source.split('\n').find((line) => /^\s*Xvfb /.test(line));
    assert.ok(command, 'starts Xvfb');
    assert.match(command, /\s-noreset(?:\s|$)/);
    assert.doesNotMatch(command, /\s2>/);
  });
}
