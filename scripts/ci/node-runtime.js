// Run from the repository root. Check pins by default; --update reads the
// official https://nodejs.org/dist/index.json from stdin and updates both pins.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

assert(
  process.argv.length === 2 ||
    (process.argv.length === 3 && process.argv[2] === '--update'),
  'Usage: node scripts/ci/node-runtime.js [--update]',
);
const nvmrc = readFileSync('.nvmrc', 'utf8');
const current = nvmrc.trim();
// Docker workflows consume this file directly, without whitespace trimming.
assert(
  nvmrc === current || nvmrc === `${current}\n`,
  '.nvmrc must contain only the version and an optional final newline',
);
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
assert(stable.test(current), '.nvmrc must pin a stable Node version');
const dockerPath = 'docker/base/Dockerfile';
const docker = readFileSync(dockerPath, 'utf8');
const pins = [...docker.matchAll(/^ARG NODE_VERSION=(\S+)$/gm)];
assert(
  pins.length === 1 && pins[0][1] === current,
  '.nvmrc and Docker NODE_VERSION must match',
);

if (process.argv[2] === '--update') {
  assert(
    current.startsWith('v26.'),
    'Automatic updates are restricted to Node 26.x',
  );
  const releases = JSON.parse(readFileSync(0, 'utf8'));
  assert(Array.isArray(releases), 'Expected a Node release index array');
  const versions = releases
    .map((release) => release?.version)
    .filter(
      (version) =>
        typeof version === 'string' &&
        stable.test(version) &&
        version.startsWith('v26.'),
    );
  assert(versions.length, 'No stable Node 26.x releases found');
  // Numeric collation compares every component, including multi-digit patches.
  const latest = [current, ...versions]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .at(-1);
  if (latest !== current) {
    writeFileSync('.nvmrc', `${latest}\n`);
    writeFileSync(
      dockerPath,
      docker.replace(pins[0][0], `ARG NODE_VERSION=${latest}`),
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${latest}\n`);
  }
  console.log(`Node runtime: ${current} -> ${latest}`);
} else {
  console.log(`Node runtime pins match: ${current}`);
}
