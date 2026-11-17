// Resolve a successful PR Checks head to an eligible Dependabot PR using only
// GitHub API data. Run trusted default-branch code, never code from the PR.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const repo = process.env.GH_REPO;
const sha = process.env.RUN_HEAD_SHA;
assert(repo === 'browserless/browserless', 'Unexpected repository');
assert(/^[a-f0-9]{40}$/.test(sha), 'Expected the tested head SHA');
const api = (path, ...args) =>
  JSON.parse(
    execFileSync('gh', ['api', `repos/${repo}/${path}`, ...args], {
      encoding: 'utf8',
    }),
  );

// workflow_run.pull_requests can be empty, including on same-repository runs.
const pr = api(`commits/${sha}/pulls?per_page=100`).find(
  (pr) =>
    pr.user.login === 'dependabot[bot]' &&
    pr.state === 'open' &&
    !pr.draft &&
    pr.head.sha === sha &&
    pr.head.repo?.full_name === repo &&
    pr.base.ref === 'main',
);
if (pr) {
  // Preserve fetch-metadata's provenance checks on the first commit, including
  // when maintainers have added later commits to the Dependabot PR.
  const first = api(`pulls/${pr.number}/commits`, '--jq', '.[0]');
  const dependencies = [
    ...first.commit.message.matchAll(/^\s*- dependency-name:\s*(.+)$/gm),
  ].map((match) => match[1]);
  if (
    first.author?.login === 'dependabot[bot]' &&
    first.commit.verification.verified &&
    dependencies.length &&
    !dependencies.some((name) => name.includes('playwright-core'))
  ) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `pr_number=${pr.number}\nhead_sha=${sha}\n`,
    );
  }
}
