import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const installer = fileURLToPath(
  new URL('./install-adblock.js', import.meta.url),
);
async function fixture(t, version = '2026.1.1') {
  const cwd = await mkdtemp(join(tmpdir(), 'adblock-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    join(cwd, 'manifest.json'),
    JSON.stringify({ version, manifest_version: 3 }),
  );
  await exec(
    'python3',
    [
      '-c',
      'import zipfile; z=zipfile.ZipFile("fixture.zip","w"); z.write("manifest.json"); z.close()',
    ],
    { cwd },
  );
  const bytes = await readFile(join(cwd, 'fixture.zip'));
  const asset = {
    name: `uBOLite_${version}.chromium.zip`,
    browser_download_url: `https://github.com/uBlockOrigin/uBOL-home/releases/download/${version}/uBOLite_${version}.chromium.zip`,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
  return {
    cwd,
    bytes: bytes.toString('base64'),
    release: { tag_name: version, assets: [asset] },
  };
}
async function run(f, options = {}) {
  const source = `
    const f=${JSON.stringify(f)};
    const options=${JSON.stringify(options)};
    let requests=0;
    globalThis.fetch=async(url,init)=>{
      requests++;
      if(String(url).startsWith('https://api.github.com/')) {
        if(init?.headers?.Authorization!=='Bearer test-only') throw new Error('API token missing');
        if(options.network) throw new Error('DO-NOT-LOG-SECRET');
        if(requests <= (options.transientFailures ?? 0)) return new Response('',{status:503});
        return new Response(options.malformed ? 'DO-NOT-LOG-SECRET' : JSON.stringify(options.release ?? f.release),
          {status:options.status??200,headers:options.headers});
      }
      if(init?.headers?.Authorization) throw new Error('Token forwarded to asset');
      if(url!==f.release.assets[0].browser_download_url) throw new Error('Incorrect asset selected');
      return new Response(options.corrupt ? 'DO-NOT-LOG-SECRET' : Buffer.from(f.bytes,'base64'),{status:options.assetStatus??200});
    };
    process.on('beforeExit',()=>console.log('requests='+requests));
    await import(${JSON.stringify(installer)});
  `;
  try {
    const result = await exec(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        cwd: f.cwd,
        env: {
          ...process.env,
          GITHUB_TOKEN: 'test-only',
          FORCE_ADBLOCK: 'true',
        },
      },
    );
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    return { code: error.code, output: error.stdout + error.stderr };
  }
}
test('selects Chromium regardless of asset ordering and verifies its digest', async (t) => {
  const f = await fixture(t);
  const release = {
    ...f.release,
    assets: [{ name: 'other.zip' }, ...f.release.assets],
  };
  const result = await run(f, { release });
  assert.equal(result.code, 0, result.output);
  assert.equal(
    JSON.parse(
      await readFile(join(f.cwd, 'extensions/ublocklite/manifest.json')),
    ).version,
    '2026.1.1',
  );
});
test('fresh release wins over cache; updates are not pinned', async (t) => {
  const f = await fixture(t, '2026.2.2');
  const old = await fixture(t, '2026.1.1');
  await mkdir(join(f.cwd, 'scripts/.adblock-cache'), { recursive: true });
  await writeFile(
    join(f.cwd, 'scripts/.adblock-cache/release.json'),
    JSON.stringify(old.release),
  );
  const result = await run(f);
  assert.equal(result.code, 0, result.output);
  assert.equal(
    JSON.parse(
      await readFile(join(f.cwd, 'extensions/ublocklite/manifest.json')),
    ).version,
    '2026.2.2',
  );
});
test('rate limit uses validated runtime cache without logging response body', async (t) => {
  const f = await fixture(t);
  assert.equal((await run(f)).code, 0);
  const result = await run(f, {
    status: 403,
    headers: { 'retry-after': '3600', 'x-ratelimit-remaining': '0' },
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /cached release/);
  assert.match(result.output, /requests=2/);
});
for (const [name, options, expected] of [
  ['missing assets', { release: { tag_name: '2026.1.1' } }, /Chromium asset/],
  ['malformed JSON', { malformed: true }, /Invalid release JSON/],
  [
    'rate limit without cache',
    { status: 429, headers: { 'retry-after': '3600' } },
    /HTTP 429/,
  ],
  ['API error', { status: 401 }, /HTTP 401/],
  ['missing archive', { assetStatus: 404 }, /HTTP 404/],
  ['network failure', { network: true }, /failure after 3 attempts/],
  ['checksum mismatch', { corrupt: true }, /SHA-256 mismatch/],
]) {
  test(`${name} fails safely and preserves the installed extension`, async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.cwd, 'extensions/ublocklite'), { recursive: true });
    await writeFile(join(f.cwd, 'extensions/ublocklite/manifest.json'), 'old');
    const result = await run(f, options);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, expected);
    assert.doesNotMatch(result.output, /DO-NOT-LOG-SECRET/);
    assert.equal(
      await readFile(
        join(f.cwd, 'extensions/ublocklite/manifest.json'),
        'utf8',
      ),
      'old',
    );
  });
}

test('transient server errors retry and then install successfully', async (t) => {
  const f = await fixture(t);
  const result = await run(f, { transientFailures: 2 });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /requests=4/);
});

test('malformed fresh metadata does not silently fall back to a stale release', async (t) => {
  const f = await fixture(t);
  assert.equal((await run(f)).code, 0);
  const result = await run(f, { malformed: true });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Invalid release JSON/);
  assert.doesNotMatch(result.output, /cached release/);
});

test('cached asset URL cannot redirect downloads to another repository', async (t) => {
  const f = await fixture(t);
  const release = structuredClone(f.release);
  release.assets[0].browser_download_url =
    'https://github.com/other/repo/releases/download/evil.zip';
  await mkdir(join(f.cwd, 'scripts/.adblock-cache'), { recursive: true });
  await writeFile(
    join(f.cwd, 'scripts/.adblock-cache/release.json'),
    JSON.stringify(release),
  );
  const result = await run(f, { status: 429 });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Invalid Chromium asset URL/);
  assert.match(result.output, /requests=1/);
});

test(
  'persists release cache with extensions on a separate filesystem',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const f = await fixture(t);
    const extensions = await mkdtemp('/dev/shm/adblock-test-');
    t.after(() => rm(extensions, { recursive: true, force: true }));
    if ((await stat(f.cwd)).dev === (await stat(extensions)).dev) {
      t.skip('requires two distinct filesystems');
      return;
    }
    await symlink(extensions, join(f.cwd, 'extensions'));
    const result = await run(f);
    assert.equal(result.code, 0, result.output);
    assert.equal(
      JSON.parse(
        await readFile(join(f.cwd, 'scripts/.adblock-cache/release.json')),
      ).tag_name,
      '2026.1.1',
    );
    assert.equal(
      JSON.parse(await readFile(join(extensions, 'ublocklite/manifest.json')))
        .version,
      '2026.1.1',
    );
  },
);

test('cache write failure does not fail a verified installation', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'scripts'), 'blocks cache directory creation');
  const result = await run(f);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Could not persist release cache/);
  assert.equal(
    JSON.parse(
      await readFile(join(f.cwd, 'extensions/ublocklite/manifest.json')),
    ).version,
    '2026.1.1',
  );
});
