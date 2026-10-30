import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'chai';

describe('Versioned browser installation policy', () => {
  let fixture: string;
  const versions = ['1.58', '1.59', '1.60', '1.61', '1.100'];
  const installer = path.resolve('scripts/install-versioned-browsers.sh');

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'browserless-installer-'));
    for (const pkg of [
      ...versions.map((v) => `playwright-${v}`),
      'playwright-core',
    ]) {
      const dir = path.join(fixture, 'node_modules', pkg);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'cli.js'), '');
    }
    const cache = path.join(fixture, 'ms-playwright', 'ready');
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, 'INSTALLATION_COMPLETE'), '');
    mkdirSync(path.join(fixture, 'bin'));
    // Test version selection, not the host's timeout utility (absent on macOS).
    // execFileSync below already bounds the entire fixture run.
    writeFileSync(
      path.join(fixture, 'bin', 'timeout'),
      '#!/bin/sh\nshift 3\nexec "$@"\n',
      { mode: 0o755 },
    );
    // Record CLI calls while reusing a completed cache: no downloads or apt.
    writeFileSync(
      path.join(fixture, 'bin', 'node'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args.includes('--dry-run')) {
  console.log('Install location: ' + ${JSON.stringify(cache)});
  console.log('https://example.test/browser.zip');
}
`,
      { mode: 0o755 },
    );
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  for (const browser of ['webkit', 'chromium', 'firefox']) {
    it(`selects the supported versions for ${browser}`, () => {
      const callsFile = path.join(fixture, 'calls');
      execFileSync('bash', [installer, browser], {
        cwd: fixture,
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${path.join(fixture, 'bin')}:${process.env.PATH}`,
          CALLS: callsFile,
        },
      });
      const calls: string[][] = readFileSync(callsFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const supported = browser === 'webkit' ? ['1.61', '1.100'] : versions;
      expect(calls).to.deep.equal([
        ['node_modules/playwright-core/cli.js', 'install-deps', browser],
        ...supported
          .map((v) => `playwright-${v}`)
          .sort()
          .concat('playwright-core')
          .flatMap((pkg) => [
            [`node_modules/${pkg}/cli.js`, 'install', browser, '--dry-run'],
            [`node_modules/${pkg}/cli.js`, 'install', browser],
          ]),
      ]);
    });
  }
});
