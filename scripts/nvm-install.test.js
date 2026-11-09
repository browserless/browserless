import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dockerfile = readFileSync(
  new URL('../docker/base/Dockerfile', import.meta.url),
  'utf8',
);
const command = dockerfile.match(/RUN curl[\s\S]*?(?=\n\n)/)[0].slice(4);

test('nvm installation fails closed before executing unverified downloads', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nvm-install-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const payload = 'echo executed > "$MARKER"\n';
  // Replace only the download boundary; Bash and sha256sum remain real.
  writeFileSync(
    join(dir, 'curl'),
    `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; output="$1"; fi
  shift
done
if [ -n "$output" ]; then cat "$PAYLOAD" > "$output"; else cat "$PAYLOAD"; fi
exit "$DOWNLOAD_STATUS"
`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, 'nvm.sh'), 'nvm() { :; }; npm() { :; }\n');
  for (const scenario of [
    'tampered',
    'empty',
    'download failure',
    'valid',
    'installer failure',
  ]) {
    rmSync(join(dir, 'executed'), { force: true });
    const bytes =
      scenario === 'empty'
        ? ''
        : payload + (scenario === 'installer failure' ? 'exit 1\n' : '');
    writeFileSync(join(dir, 'payload'), bytes);
    const trusted = scenario === 'valid' || scenario === 'installer failure';
    const script = command
      .replaceAll('/tmp/nvm-install.sh', join(dir, 'installer.sh'))
      .replace(/[a-f0-9]{64}/g, (hash) =>
        trusted || scenario === 'download failure'
          ? createHash('sha256').update(bytes).digest('hex')
          : hash,
      );
    const result = spawnSync('/bin/sh', ['-c', script], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        NVM_DIR: dir,
        PAYLOAD: join(dir, 'payload'),
        MARKER: join(dir, 'executed'),
        DOWNLOAD_STATUS: scenario === 'download failure' ? '22' : '0',
      },
      encoding: 'utf8',
    });
    assert.equal(
      result.status === 0,
      scenario === 'valid',
      `${scenario}: ${result.stderr}`,
    );
    if (!trusted) {
      assert.throws(
        () => readFileSync(join(dir, 'executed')),
        { code: 'ENOENT' },
        scenario,
      );
    } else {
      assert.equal(readFileSync(join(dir, 'executed'), 'utf8'), 'executed\n');
    }
  }
});
