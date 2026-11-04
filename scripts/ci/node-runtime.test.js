import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./node-runtime.js', import.meta.url));

function fixture(t, version = 'v26.9.0', dockerVersion = version) {
  const cwd = mkdtempSync(join(tmpdir(), 'node-runtime-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'docker/base'), { recursive: true });
  writeFileSync(join(cwd, '.nvmrc'), `${version}\n`);
  writeFileSync(
    join(cwd, 'docker/base/Dockerfile'),
    `FROM ubuntu:resolute\nARG NODE_VERSION=${dockerVersion}\nARG NPM_VERSION=11.21.1\n`,
  );
  return {
    run: (index) =>
      spawnSync(
        process.execPath,
        [script, ...(index === undefined ? [] : ['--update'])],
        {
          cwd,
          encoding: 'utf8',
          input: JSON.stringify(index),
          env: { ...process.env, GITHUB_OUTPUT: join(cwd, 'output') },
        },
      ),
    read: (path) => readFileSync(join(cwd, path), 'utf8'),
  };
}

test('updates both pins to the highest stable 26.x numerically, then does nothing on rerun', (t) => {
  const f = fixture(t);
  const index = [
    'v27.0.0',
    'v26.10.2',
    'v26.10.10',
    'v26.11.0-rc.1',
    'v26.9.9',
    'v24.99.0',
    'v26.10.10\ninjected=yes',
    'v26.99.0\n',
  ].map((version) => ({ version }));
  assert.equal(f.run(index).status, 0);
  assert.equal(f.read('.nvmrc'), 'v26.10.10\n');
  assert.equal(f.read('output'), 'version=v26.10.10\n');
  assert.equal(
    f.read('docker/base/Dockerfile'),
    'FROM ubuntu:resolute\nARG NODE_VERSION=v26.10.10\nARG NPM_VERSION=11.21.1\n',
  );
  assert.equal(f.run(index).status, 0);
  assert.equal(f.read('.nvmrc'), 'v26.10.10\n');
  assert.equal(f.run([{ version: 'v26.8.0' }]).status, 0);
  assert.equal(f.read('.nvmrc'), 'v26.10.10\n');
});

test('check accepts matching pins and rejects drift or non-stable pins without changing files', (t) => {
  assert.equal(fixture(t).run().status, 0);
  for (const [nvm, docker] of [
    ['v26.9.0', 'v26.8.0'],
    ['v26.9.0-rc.1', 'v26.9.0-rc.1'],
    ['v26.9.0 ', 'v26.9.0'],
    ['\nv26.9.0', 'v26.9.0'],
  ]) {
    const f = fixture(t, nvm, docker);
    assert.notEqual(f.run().status, 0);
    assert.notEqual(f.run([{ version: 'v26.10.0' }]).status, 0);
    assert.equal(f.read('.nvmrc'), `${nvm}\n`);
  }
});

test('fails closed on unusable release indexes or a manually changed major', (t) => {
  for (const index of [
    [],
    {},
    null,
    [{ version: 'v27.1.0' }],
    [{ version: 'v26.11.0-rc.1' }],
  ]) {
    const f = fixture(t);
    assert.notEqual(f.run(index).status, 0);
    assert.equal(f.read('.nvmrc'), 'v26.9.0\n');
  }
  const f = fixture(t, 'v28.0.0');
  assert.equal(f.run().status, 0);
  assert.notEqual(f.run([{ version: 'v26.10.0' }]).status, 0);
  assert.equal(f.read('.nvmrc'), 'v28.0.0\n');
});
