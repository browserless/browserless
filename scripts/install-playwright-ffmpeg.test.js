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
  await copyFile(
    new URL('./install-playwright-ffmpeg.js', import.meta.url),
    join(sdk, 'scripts/install-playwright-ffmpeg.js'),
  );
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
  const addPackage = async (owner, name, revision, fail = false) => {
    const dir = join(owner, 'node_modules', name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name, bin: { 'playwright-core': 'cli.js' } }),
    );
    await writeFile(
      join(dir, 'cli.js'),
      `
      const fs = require('node:fs');
      if (process.argv.slice(2).join(' ') !== 'install ffmpeg') process.exit(2);
      if (process.env.PLAYWRIGHT_SKIP_BROWSER_GC !== '1') process.exit(3);
      if (${fail}) process.exit(4);
      fs.writeFileSync(require('node:path').join(process.env.PLAYWRIGHT_BROWSERS_PATH, '${revision}'), 'installed');
    `,
    );
  };
  await addPackage(sdk, 'encoder-current', '900');
  await addPackage(sdk, 'encoder-older', '800');
  const run = () =>
    exec(
      process.execPath,
      [join(sdk, 'scripts/install-playwright-ffmpeg.js')],
      {
        cwd: root,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache },
      },
    );
  return { root, sdk, cache, run, addPackage };
}

test('installs the SDK support map when the consumer does not override it', async (t) => {
  const f = await fixture(t);
  // A same-named consumer dependency must not shadow the SDK's pinned package.
  await f.addPackage(f.root, 'encoder-current', 'wrong');
  await f.run();
  assert.deepEqual((await readdir(f.cache)).sort(), ['800', '900']);
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
  await f.run();
  await f.run();
  assert.deepEqual((await readdir(f.cache)).sort(), [
    '700',
    'existing-browser',
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
  assert.deepEqual((await readdir(f.cache)).sort(), ['800', '900']);
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
  assert.deepEqual(await readdir(f.cache), ['900']);
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
