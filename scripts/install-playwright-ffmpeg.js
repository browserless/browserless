import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractZip } from './extract-zip-native.js';

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

// Node only applies HTTPS_PROXY/NO_PROXY to fetch() when started with
// `--use-env-proxy` (the Dockerfiles do), so proxied builds keep working.
const download = async (urls) => {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.warn(`  mirror failed (${error.message}): ${url}`);
    }
  }
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
      const zip = join(staging, 'ffmpeg.zip');
      await writeFile(zip, await download(urls));
      // Extract into a clean dir and only mark complete on a verified
      // extraction, so a partial unzip is never cached as installed.
      await rm(dir, { force: true, recursive: true });
      await mkdir(dir, { recursive: true });
      await extractZip(zip, dir);
      if (!(await readdir(dir)).length) {
        await rm(dir, { force: true, recursive: true });
        throw new Error(`Empty FFmpeg extraction for ${name} in ${dir}`);
      }
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
