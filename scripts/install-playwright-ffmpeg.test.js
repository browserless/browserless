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
import { createServer } from 'node:net';
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
        console.log('  Download url:        http://mirror.invalid/missing/${revision}.zip');
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
  // `serve` is the base64 body the fallback mirror returns; null makes every
  // mirror 404. `first` is a base64 body the primary mirror returns with a 200
  // instead of its default 404, or 'stall' for a 200 whose body sends one byte
  // and then never ends. Proxy variables are cleared so a developer's proxy
  // does not make the installer re-run itself outside this fetch() stub.
  const run = async (serve = archive, env = {}, first = null) => {
    const source = `
      const requests = [];
      const bodies = {
        'http://mirror.invalid/missing/': ${JSON.stringify(first)},
        'https://mirror.invalid/builds/': ${JSON.stringify(serve)},
      };
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        const body = Object.entries(bodies).find(([prefix]) =>
          String(url).startsWith(prefix),
        )?.[1];
        if (body === null || body === undefined) {
          return new Response('', { status: 404 });
        }
        if (body === 'stall') {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([0x50]));
              },
            }),
          );
        }
        return new Response(Buffer.from(body, 'base64'));
      };
      process.on('beforeExit', () => console.log('requests=' + requests.join(' ')));
      await import(${JSON.stringify(join(sdk, 'scripts/install-playwright-ffmpeg.js'))});
    `;
    const { stdout } = await exec(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        cwd: root,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) =>
                !/^(https?_proxy|no_proxy|node_use_env_proxy)$/i.test(name),
            ),
          ),
          PLAYWRIGHT_BROWSERS_PATH: cache,
          ...env,
        },
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
  // The first (plain-HTTP, as a PLAYWRIGHT_DOWNLOAD_HOST mirror may be) URL
  // 404s, so each package falls back to the next one.
  assert.deepEqual(requests, [
    'http://mirror.invalid/missing/900.zip',
    'https://mirror.invalid/builds/900.zip',
    'http://mirror.invalid/missing/800.zip',
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
  // A well-formed archive that lacks the executable is just as broken.
  await exec(
    'python3',
    [
      '-c',
      'import zipfile; z=zipfile.ZipFile("license-only.zip","w"); z.writestr("COPYING", "license"); z.close()',
    ],
    { cwd: f.root },
  );
  await assert.rejects(
    f.run(
      (await readFile(join(f.root, 'license-only.zip'))).toString('base64'),
    ),
    /All FFmpeg mirrors failed/,
  );
  assert.deepEqual(await readdir(f.cache), []);
  await assert.rejects(
    f.run(Buffer.from('not a zip').toString('base64')),
    /All FFmpeg mirrors failed/,
  );
  assert.deepEqual(await readdir(f.cache), []);
  // Leftovers from an interrupted attempt must not survive the retry.
  await mkdir(join(f.cache, 'ffmpeg-900'));
  await writeFile(join(f.cache, 'ffmpeg-900', 'stale'), '');
  // A later run with a healthy mirror recovers from the partial state.
  await f.run();
  assert.deepEqual(await installed(f.cache), [
    ['ffmpeg-800', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
    ['ffmpeg-900', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
});

test('a mirror serving a corrupt or incomplete archive falls through to the next one', async (t) => {
  const f = await fixture(t);
  const good = (await readFile(join(f.root, 'fixture.zip'))).toString('base64');
  // HTTP 200 with a body unzip rejects.
  const corrupt = Buffer.from('not a zip').toString('base64');
  let requests = await f.run(good, {}, corrupt);
  assert.deepEqual(requests, [
    'http://mirror.invalid/missing/900.zip',
    'https://mirror.invalid/builds/900.zip',
    'http://mirror.invalid/missing/800.zip',
    'https://mirror.invalid/builds/800.zip',
  ]);
  assert.deepEqual(await installed(f.cache), [
    ['ffmpeg-800', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
    ['ffmpeg-900', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
  assert.equal(
    await readFile(join(f.cache, 'ffmpeg-900/ffmpeg-linux'), 'utf8'),
    'binary',
  );
  // HTTP 200 with a valid archive that lacks the executable: the fallback's
  // files replace it rather than merge with it.
  await rm(f.cache, { recursive: true });
  await mkdir(f.cache);
  await exec(
    'python3',
    [
      '-c',
      'import zipfile; z=zipfile.ZipFile("license-only.zip","w"); z.writestr("COPYING", "license"); z.close()',
    ],
    { cwd: f.root },
  );
  requests = await f.run(
    good,
    {},
    (await readFile(join(f.root, 'license-only.zip'))).toString('base64'),
  );
  assert.equal(requests.length, 4);
  assert.deepEqual(await installed(f.cache), [
    ['ffmpeg-800', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
    ['ffmpeg-900', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
});

test('a mirror that stops sending data is abandoned in time for the next one', async (t) => {
  const f = await fixture(t);
  const started = Date.now();
  const requests = await f.run(
    undefined,
    { PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '200' },
    'stall',
  );
  // Each stalled primary mirror is dropped after the idle window, not after
  // the 600 s deadline (or the 30 s default window) it would otherwise eat.
  assert.ok(Date.now() - started < 10_000);
  assert.deepEqual(requests, [
    'http://mirror.invalid/missing/900.zip',
    'https://mirror.invalid/builds/900.zip',
    'http://mirror.invalid/missing/800.zip',
    'https://mirror.invalid/builds/800.zip',
  ]);
  assert.deepEqual(await installed(f.cache), [
    ['ffmpeg-800', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
    ['ffmpeg-900', ['INSTALLATION_COMPLETE', 'ffmpeg-linux']],
  ]);
  assert.equal(
    await readFile(join(f.cache, 'ffmpeg-900/ffmpeg-linux'), 'utf8'),
    'binary',
  );
});

test('a configured proxy is used however the installer is started', async (t) => {
  const f = await fixture(t);
  // The stand-in proxy records what reaches it and refuses every request.
  const seen = [];
  const proxy = createServer((socket) => {
    socket.once('data', (data) => {
      seen.push(data.toString().split('\r\n')[0]);
      socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
  });
  await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
  t.after(() => proxy.close());
  const { port } = proxy.address();
  // No NODE_USE_ENV_PROXY in the environment: the installer re-runs itself
  // with it, so the (unstubbed) fetch() reaches the proxy instead of the host.
  await assert.rejects(
    f.run(undefined, { HTTP_PROXY: `http://127.0.0.1:${port}` }),
    /All FFmpeg mirrors failed/,
  );
  // Both mirrors go through the proxy: HTTPS as a CONNECT tunnel, plain HTTP
  // as a forwarded GET or, on older Node releases, a tunnel too.
  assert.equal(seen.length, 2, seen.join('\n'));
  assert.ok(
    seen.every((line) => /^(GET|CONNECT) \S*mirror\.invalid/.test(line)),
    seen.join('\n'),
  );
  assert.deepEqual(await readdir(f.cache), []);
});
