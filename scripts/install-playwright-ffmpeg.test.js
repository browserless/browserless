import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ffmpeg-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = join(root, 'node_modules/sdk');
  await mkdir(join(sdk, 'scripts'), { recursive: true });
  for (const script of [
    'install-playwright-ffmpeg.js',
    'extract-zip-native.js',
  ]) {
    await copyFile(
      new URL(`./${script}`, import.meta.url),
      join(sdk, 'scripts', script),
    );
  }
  await writeFile(
    join(sdk, 'package.json'),
    JSON.stringify({
      type: 'module',
      playwrightVersions: {
        default: 'encoder-current',
        older: 'encoder-older',
      },
    }),
  );
  await writeFile(join(root, 'package.json'), '{}');
  const cache = join(root, 'cache');
  await mkdir(cache);
  // The archive every mirror serves: a single `ffmpeg-linux` binary.
  await writeFile(join(root, 'ffmpeg-linux'), 'binary');
  await exec(
    'python3',
    [
      '-c',
      'import zipfile; z=zipfile.ZipFile("fixture.zip","w"); z.write("ffmpeg-linux"); z.close()',
    ],
    { cwd: root },
  );
  const archive = (await readFile(join(root, 'fixture.zip'))).toString(
    'base64',
  );
  const addPackage = async (owner, name, revision, fail = false) => {
    const dir = join(owner, 'node_modules', name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name, bin: { 'playwright-core': 'cli.js' } }),
    );
    // Mirrors Playwright's CLI: a dry run reports where the archive goes and
    // its mirrors; a real install only passes once the completion marker is
    // present (otherwise it would extract the archive itself).
    await writeFile(
      join(dir, 'cli.js'),
      `
      const fs = require('node:fs');
      const path = require('node:path');
      const args = process.argv.slice(2).join(' ');
      if (process.env.PLAYWRIGHT_SKIP_BROWSER_GC !== '1') process.exit(3);
      if (${fail}) process.exit(4);
      const dir = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'ffmpeg-${revision}');
      if (args === 'install ffmpeg --dry-run') {
        console.log('browser: ffmpeg');
        console.log('  Install location:    ' + dir);
        console.log('  Download url:        https://mirror.invalid/missing/${revision}.zip');
        console.log('  Download fallback 1: https://mirror.invalid/builds/${revision}.zip');
        process.exit(0);
      }
      if (args !== 'install ffmpeg') process.exit(2);
      if (!fs.existsSync(path.join(dir, 'INSTALLATION_COMPLETE'))) process.exit(5);
    `,
    );
  };
  await addPackage(sdk, 'encoder-current', '900');
  await addPackage(sdk, 'encoder-older', '800');
  // `serve` is the base64 body the working mirror returns; null makes every
  // mirror 404.
  const run = async (serve = archive) => {
    const source = `
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        if (
          ${serve === null} ||
          !String(url).startsWith('https://mirror.invalid/builds/')
        ) {
          return new Response('', { status: 404 });
        }
        return new Response(Buffer.from(${JSON.stringify(serve)}, 'base64'));
      };
      process.on('beforeExit', () => console.log('requests=' + requests.join(' ')));
      await import(${JSON.stringify(join(sdk, 'scripts/install-playwright-ffmpeg.js'))});
    `;
    const { stdout } = await exec(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        cwd: root,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache },
      },
    );
    return stdout
      .match(/^requests=(.*)$/m)[1]
      .split(' ')
      .filter(Boolean);
  };
  return { root, sdk, cache, run, addPackage };
}

const installed = async (cache) =>
  Promise.all(
    (await readdir(cache))
      .sort()
      .map(async (name) => [
        name,
        (await readdir(join(cache, name)).catch(() => [])).sort(),
      ]),
  );

test('installs the SDK support map when the consumer does not override it', async (t) => {
  const f = await fixture(t);
  // A same-named consumer dependency must not shadow the SDK's pinned package.
  await f.addPackage(f.root, 'encoder-current', 'wrong');
  const requests = await f.run();
  assert.deepEqual(await installed(f.cache), [
    ['ffmpeg-800', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
    ['ffmpeg-900', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
  assert.equal(
    await readFile(join(f.cache, 'ffmpeg-900/ffmpeg-linux'), 'utf8'),
    'binary',
  );
  // The first mirror 404s, so each package falls back to the next one.
  assert.deepEqual(requests, [
    'https://mirror.invalid/missing/900.zip',
    'https://mirror.invalid/builds/900.zip',
    'https://mirror.invalid/missing/800.zip',
    'https://mirror.invalid/builds/800.zip',
  ]);
});

test('consumer aliases override the SDK map and preserve the existing cache', async (t) => {
  const f = await fixture(t);
  await f.addPackage(f.root, 'custom-protocol', '700');
  await writeFile(
    join(f.root, 'package.json'),
    JSON.stringify({
      playwrightVersions: {
        default: 'custom-protocol',
        compatible: 'custom-protocol',
      },
    }),
  );
  await writeFile(join(f.cache, 'existing-browser'), 'keep');
  const first = await f.run();
  // An installed revision is not downloaded again.
  const second = await f.run();
  assert.equal(first.length, 2);
  assert.deepEqual(second, []);
  assert.deepEqual(await installed(f.cache), [
    ['existing-browser', []],
    ['ffmpeg-700', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
  assert.equal(
    await readFile(join(f.cache, 'existing-browser'), 'utf8'),
    'keep',
  );
});

test('a missing consumer manifest still uses SDK aliases', async (t) => {
  const f = await fixture(t);
  await rm(join(f.root, 'package.json'));
  await f.run();
  assert.deepEqual((await readdir(f.cache)).sort(), [
    'ffmpeg-800',
    'ffmpeg-900',
  ]);
});

test('consumer maps use the same nested packages as the SDK runtime', async (t) => {
  const f = await fixture(t);
  await f.addPackage(f.root, 'encoder-current', 'wrong');
  await writeFile(
    join(f.root, 'package.json'),
    JSON.stringify({
      playwrightVersions: { default: 'encoder-current' },
    }),
  );
  await f.run();
  assert.deepEqual(await readdir(f.cache), ['ffmpeg-900']);
});

test('malformed consumer metadata and failed package installs fail the build', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'package.json'), '{invalid');
  await assert.rejects(f.run());
  assert.deepEqual(await readdir(f.cache), []);
  await f.addPackage(f.root, 'broken-protocol', '700', true);
  await writeFile(
    join(f.root, 'package.json'),
    JSON.stringify({ playwrightVersions: { default: 'broken-protocol' } }),
  );
  await assert.rejects(f.run());
  assert.deepEqual(await readdir(f.cache), []);
});

test('unreachable mirrors and corrupt archives never mark FFmpeg installed', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run(null), /All FFmpeg mirrors failed/);
  assert.deepEqual(await readdir(f.cache), []);
  await assert.rejects(f.run(Buffer.from('not a zip').toString('base64')));
  for (const dir of await readdir(f.cache)) {
    assert.ok(
      !(await readdir(join(f.cache, dir))).includes('INSTALLATION_COMPLETE'),
    );
  }
  // Leftovers from the failed attempt must not survive the retry.
  await writeFile(join(f.cache, 'ffmpeg-900', 'stale'), '');
  // A later run with a healthy mirror recovers from the partial state.
  await f.run();
  assert.deepEqual(await installed(f.cache), [
    ['ffmpeg-800', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
    ['ffmpeg-900', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
});
