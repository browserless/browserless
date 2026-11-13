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

const script = fileURLToPath(
  new URL('./dependabot-automerge.js', import.meta.url),
);
const sha = 'a'.repeat(40);
const repo = 'browserless/browserless';
const pr = {
  number: 42,
  user: { login: 'dependabot[bot]' },
  state: 'open',
  draft: false,
  head: { sha, repo: { full_name: repo } },
  base: { ref: 'main' },
};
const commit = {
  author: { login: 'dependabot[bot]' },
  commit: {
    verification: { verified: true },
    message:
      '---\nupdated-dependencies:\n- dependency-name: puppeteer-core\n...',
  },
};

function run(t, pulls = [pr], firstCommit = commit) {
  const cwd = mkdtempSync(join(tmpdir(), 'dependabot-automerge-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'bin'));
  // Only the GitHub API boundary is substituted; the eligibility CLI runs as-is.
  writeFileSync(
    join(cwd, 'bin/gh'),
    `#!${process.execPath}\nconst path = process.argv[3];
process.stdout.write(JSON.stringify(path.includes('/pulls?')
  ? ${JSON.stringify(pulls)} : ${JSON.stringify(firstCommit)}));\n`,
    { mode: 0o755 },
  );
  const output = join(cwd, 'output');
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(cwd, 'bin')}:${process.env.PATH}`,
      GH_REPO: repo,
      RUN_HEAD_SHA: sha,
      GITHUB_OUTPUT: output,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(output, 'utf8');
}

test('selects the open same-repository Dependabot PR at the tested head', (t) => {
  assert.equal(run(t), `pr_number=42\nhead_sha=${sha}\n`);
  assert.equal(run(t, []), '');
});

test('rejects human, fork, stale, closed, draft, and non-main PRs', (t) => {
  for (const overrides of [
    { user: { login: 'contributor' } },
    { head: { ...pr.head, repo: { full_name: 'someone/fork' } } },
    { head: { ...pr.head, sha: 'b'.repeat(40) } },
    { state: 'closed' },
    { draft: true },
    { base: { ref: 'other' } },
  ]) {
    assert.equal(run(t, [{ ...pr, ...overrides }]), '');
  }
});

test('requires a verified Dependabot commit and excludes grouped Playwright updates', (t) => {
  for (const firstCommit of [
    { ...commit, author: { login: 'contributor' } },
    {
      ...commit,
      commit: { ...commit.commit, verification: { verified: false } },
    },
    {
      ...commit,
      commit: { ...commit.commit, message: 'No dependency metadata' },
    },
    {
      ...commit,
      commit: {
        ...commit.commit,
        message: `${commit.commit.message}\n- dependency-name: playwright-core\n`,
      },
    },
  ]) {
    assert.equal(run(t, [pr], firstCommit), '');
  }
});
