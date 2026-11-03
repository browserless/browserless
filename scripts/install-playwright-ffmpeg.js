import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractZip } from './extract-zip-native.js';

// Node only applies HTTP(S)_PROXY/NO_PROXY to fetch() when started with
// NODE_USE_ENV_PROXY=1 (honoured from Node 24.0), so a proxied environment
// re-runs this script under it however it was invoked.
if (
  process.env.NODE_USE_ENV_PROXY !== '1' &&
  ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].some(
    (name) => process.env[name],
  )
) {
  const { status } = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url)],
    { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, stdio: 'inherit' },
  );
  process.exit(status ?? 1);
}

// Match SDK startup: a consumer's support map overrides the SDK defaults.
let manifest = resolve('package.json');
let versions;
try {
  versions = JSON.parse(readFileSync(manifest, 'utf8')).playwrightVersions;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!versions) {
  manifest = fileURLToPath(new URL('../package.json', import.meta.url));
  versions = JSON.parse(readFileSync(manifest, 'utf8')).playwrightVersions;
}
if (
  !versions ||
  typeof versions !== 'object' ||
  Array.isArray(versions) ||
  !Object.keys(versions).length ||
  Object.values(versions).some((name) => typeof name !== 'string' || !name)
) {
  throw new Error(`Invalid playwrightVersions in ${manifest}`);
}

const env = {
  ...process.env,
  // Image stages may replace package paths referenced by the shared cache.
  PLAYWRIGHT_SKIP_BROWSER_GC: '1',
  // Linux FFmpeg archives are architecture-specific static binaries. Older
  // CLIs lack Ubuntu 26.04 download entries; select their identical 24.04
  // archive without changing browser installation or runtime detection.
  ...(process.platform === 'linux' &&
  ['x64', 'arm64'].includes(process.arch) &&
  !process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE
    ? { PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: `ubuntu24.04-${process.arch}` }
    : {}),
};

// Fail the build if a CLI stops responding instead of hanging it.
const cli = (path, args, timeout, stdout = 'inherit') =>
  execFileSync(process.execPath, [path, ...args], {
    encoding: 'utf8',
    env,
    killSignal: 'SIGKILL',
    stdio: ['ignore', stdout, 'inherit'],
    timeout,
  });

// `install ffmpeg --dry-run` prints the package's install location followed by
// its download URL and ordered fallback mirrors. The URLs come from
// PLAYWRIGHT_DOWNLOAD_HOST when set, which may be a plain-HTTP mirror.
const parseDryRun = (output) => {
  const dir = output.match(/Install location:[ \t]*(.+)/)?.[1]?.trim();
  const urls = [
    ...output.matchAll(/Download (?:url|fallback \d+):[ \t]*(\S+)/g),
  ].map(([, url]) => url);
  // Guards the `rm` below against a misparsed or unexpected directory.
  if (!dir || !isAbsolute(dir) || !basename(dir).startsWith('ffmpeg')) {
    throw new Error(`Unexpected FFmpeg install location in:\n${output}`);
  }
  if (!urls.length) throw new Error(`No FFmpeg download URL in:\n${output}`);
  const unsupported = urls.find(
    (url) => !['http:', 'https:'].includes(URL.parse(url)?.protocol),
  );
  if (unsupported) {
    throw new Error(`Unsupported FFmpeg download URL: ${unsupported}`);
  }
  return { dir, urls };
};

// Same rule as Playwright's own downloader: a mirror that delivers nothing for
// PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT (30 s by default) is given up on, so
// a stalled or trickling mirror leaves the next one time under the deadline.
const idleTimeout =
  +(process.env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT || 0) || 30_000;

const download = async (url, deadline) => {
  const stalled = new AbortController();
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => stalled.abort(new Error(`no data for ${idleTimeout} ms`)),
      idleTimeout,
    );
  };
  const signal = AbortSignal.any([
    stalled.signal,
    AbortSignal.timeout(Math.max(deadline - Date.now(), 0)),
  ]);
  touch();
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    touch();
    const reader = response.body.getReader();
    signal.addEventListener('abort', () => {
      reader.cancel(signal.reason).catch(() => {});
    });
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      chunks.push(value);
    }
    // A cancelled read ends cleanly, so a truncated body must not pass as one.
    signal.throwIfAborted();
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(idle);
  }
};

// A mirror only counts as working once its archive has been extracted into a
// clean dir and yielded the `ffmpeg-<platform>` executable: a 200 carrying a
// corrupt or unexpected archive moves on to the next mirror like an HTTP
// error does, so one bad mirror cannot block every build. All mirrors share
// one deadline so stalled ones cannot hold the build for a multiple of it.
const install = async (urls, dir, zip) => {
  const deadline = Date.now() + 600_000;
  for (const url of urls) {
    try {
      await writeFile(zip, await download(url, deadline));
      await rm(dir, { force: true, recursive: true });
      await mkdir(dir, { recursive: true });
      await extractZip(zip, dir);
      if (!(await readdir(dir)).some((entry) => entry.startsWith('ffmpeg'))) {
        throw new Error('no FFmpeg executable in archive');
      }
      return;
    } catch (error) {
      // fetch() reports "fetch failed"; the cause names the socket error.
      const reason = error.cause?.message ?? error.message;
      console.warn(`  mirror failed (${reason}): ${url}`);
    }
  }
  // Nothing partial survives to the next build, which retries every mirror.
  await rm(dir, { force: true, recursive: true });
  throw new Error(`All FFmpeg mirrors failed: ${urls.join(', ')}`);
};

// Config.loadPwVersion imports from inside the SDK, including nested deps.
const require = createRequire(import.meta.url);
const staging = await mkdtemp(join(tmpdir(), 'playwright-ffmpeg-'));
try {
  for (const name of new Set(Object.values(versions))) {
    const path = join(
      dirname(require.resolve(`${name}/package.json`)),
      'cli.js',
    );
    console.log(`Installing FFmpeg for ${name}`);
    // Fetch and unzip the archive ourselves instead of letting
    // `playwright install` extract it: playwright-core < 1.60.0 deadlocks
    // during zip extraction on Node 24.16–24.17 and >= 26 (the same bug, and
    // the same workaround, as scripts/install-versioned-browsers.sh).
    const { dir, urls } = parseDryRun(
      cli(path, ['install', 'ffmpeg', '--dry-run'], 60_000, 'pipe'),
    );
    if (existsSync(join(dir, 'INSTALLATION_COMPLETE'))) {
      console.log(`  already present: ${dir}`);
    } else {
      console.log(`  Fetching ${basename(dir)}`);
      await install(urls, dir, join(staging, 'ffmpeg.zip'));
      // Only marked complete once a mirror's archive has been fully extracted,
      // so a partial unzip is never cached as installed.
      await writeFile(join(dir, 'INSTALLATION_COMPLETE'), '');
    }
    // Let Playwright validate its own view: with the marker present this
    // exits without extracting. A missing component would make it re-extract
    // (and deadlock on the broken versions), so bound it.
    cli(path, ['install', 'ffmpeg'], 120_000);
  }
} finally {
  await rm(staging, { force: true, recursive: true });
}
