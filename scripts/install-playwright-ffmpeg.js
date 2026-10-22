import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Config.loadPwVersion imports from inside the SDK, including nested deps.
const require = createRequire(import.meta.url);
for (const name of new Set(Object.values(versions))) {
  const cli = join(dirname(require.resolve(`${name}/package.json`)), 'cli.js');
  console.log(`Installing FFmpeg for ${name}`);
  execFileSync(process.execPath, [cli, 'install', 'ffmpeg'], {
    stdio: 'inherit',
    // Fail the build if a package's downloader or extractor stops responding.
    timeout: 600_000,
    killSignal: 'SIGKILL',
    env: {
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
    },
  });
}
