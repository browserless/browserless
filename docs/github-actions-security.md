# GitHub Actions security

This inventory applies to `browserless/browserless`. Workflow files enforce the
checks below; repository and organization settings require an administrator.
No CODEOWNERS file or settings changes are included in this rollout.

## PR checks and lockfile maintenance

`pr-checks.yml` calls `lint.yml` on pull requests without path filters. Its
read-only `lockfile`, `zizmor`, and `actionlint` jobs check the repository without
installing application dependencies or running their lifecycle scripts. All
checkouts disable credential persistence. The existing automerge job waits for
the entire reusable lint workflow as well as the browser checks.

- `lockfile`: `github/gh-actions-lock` v0.4.1, authenticated with `github.token`.
- `zizmor`: 1.32.0, run as `zizmor .` from the repository root, with a read-only
  token for online audits and native lockfile support.
- `actionlint`: 1.7.12 with ShellCheck 0.11.0 on PATH. It checks expressions,
  workflow structure, reusable-workflow contracts, and shell scripts.

The last two tools are release binaries whose SHA-256 hashes are pinned in
`lint.yml`. Update each version, URL, and checksum together after reviewing its
release. Dependabot does not maintain these shell download URLs or the CLI
extension installation pin; maintainers must review those separately. These are
CI checks, not optional local pre-commit hooks. zizmor detects security and trust
boundary problems; actionlint and ShellCheck complement it with correctness and
shell diagnostics.

After changing any action reference or adding a workflow/job, run:

```sh
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock
gh actions-lock --verify
zizmor .
actionlint
```

Use the pinned tool versions above, with ShellCheck available. If the extension
is already installed, confirm it is the pinned version instead of reinstalling
blindly. Review both the workflow and generated `actions.lock` diff: repository
identity, release ref, and resolved commit all matter. Never edit the lockfile by
hand. Relock after adding verification jobs, not just before them. Current
coverage is 20 workflows and 16 action repositories; same-commit reusable calls
have no external dependency entry. `hmarr/auto-approve-action@v4` remains a major
ref, but its commit and repository identity are locked.

The GitHub Actions Dependabot ecosystem is configured and supports updating
`actions.lock`. Confirm the first bot update changes both files as needed and
passes verification; a stale or incomplete bot update must be relocked before
merge. No Renovate setup is needed alongside it.

## Approved policy and analyzer limitations

`.github/dependabot.yml` is unchanged. The approved choice is to retain the
existing three-day cooldown for npm and GitHub Actions, rather than zizmor's
seven-day recommendation. **Docker has no configured cooldown** in the existing
file; the instruction to leave that file unchanged preserves that gap, not a
three-day Docker cooldown. `.github/zizmor.yml` exempts only the three existing
cooldown finding locations. A new ecosystem without a cooldown still fails.

`merge-dependabot.yml` retains its eligibility, approval ordering, and auto-merge
behavior: Dependabot PRs in this repository are approved; auto-merge excludes
`playwright-core`, but is not limited to patch/minor releases or selected
ecosystems. Tightening that policy requires a separate decision.

Other zizmor exceptions are inline and limited to same-commit reusable workflow
calls, exact npm bootstrap commands with lifecycle scripts disabled, and the
guarded release `workflow_run` trigger. That trigger accepts only a successful
same-repository main-branch push publisher and consumes no PR artifacts.

`.github/actionlint.yaml` ignores only the unknown-label diagnostics for
`ubuntu-26.04` and `ubuntu-26.04-arm`, which are newer than actionlint's bundled
runner metadata. Remove this exception when upgrading to metadata that supports
them. Other runner typos, expressions, and shell errors remain fatal.

**actionlint 1.7.12 validates known remote-action input schemas at major refs,
not full-semver refs.** Lockfile conversion therefore removes the original stale
App `client-id` diagnostics by skipping that schema lookup, not by fixing the
metadata. There is no broad input-error suppression, but maintainers must review
inputs against the pinned action's `action.yml`; a green actionlint run alone
does not prove those inputs are valid. Local reusable-workflow inputs/secrets
remain checked. The one ShellCheck SC2016 exception in `release-please.yml`
allows deliberate delayed expansion by the transient Git credential helper.

## Action inventory and proposed allowlist

The lockfile is the source of truth for exact versions and commits. Administrators
can use these repository-scoped patterns in the selected-actions allowlist;
avoid organization-wide wildcards. These patterns permit refs, while the lockfile
constrains the resolved code. GitHub-owned actions are included explicitly.

| Allowed action repository               | Purpose                           |
| --------------------------------------- | --------------------------------- |
| `actions/checkout@*`                    | Source checkout                   |
| `actions/create-github-app-token@*`     | Scoped release/updater App tokens |
| `actions/download-artifact@*`           | Download image digests            |
| `actions/setup-node@*`                  | Node runtime                      |
| `actions/stale@*`                       | Issue/PR maintenance              |
| `actions/upload-artifact@*`             | Upload image digests              |
| `amannn/action-semantic-pull-request@*` | PR title validation               |
| `dependabot/fetch-metadata@*`           | Dependency update metadata        |
| `docker/build-push-action@*`            | Container builds                  |
| `docker/login-action@*`                 | Registry authentication           |
| `docker/setup-buildx-action@*`          | Buildx setup                      |
| `github/codeql-action/init@*`           | CodeQL initialization             |
| `github/codeql-action/autobuild@*`      | CodeQL build                      |
| `github/codeql-action/analyze@*`        | CodeQL analysis                   |
| `googleapis/release-please-action@*`    | Release PRs/tags                  |
| `hmarr/auto-approve-action@*`           | Dependabot approval               |
| `nick-fields/retry@*`                   | Bounded command retries           |
| `peter-evans/create-pull-request@*`     | Node runtime update PRs           |

The allowlist governs `uses:` actions, not binaries downloaded by shell commands.
Review the pinned gh-actions-lock, zizmor, actionlint, ShellCheck, and npm bootstrap
installations separately. Workflow and lockfile changes need human review; the
inventory does not itself enforce an allowlist or file ownership.

## Credentials and GHCR

Workflow defaults are empty or minimally scoped. Write permissions belong only
to publishing, release, maintenance, and automerge jobs that require them.
Publishing jobs disable dependency caches. Release/updater App tokens request
only contents and pull-request permissions. The release changelog push uses a
step-local token and transient Git credential helper, not stored checkout auth.
There is no `pull_request_target` workflow.

All four Docker publishing jobs log in with `github.actor` and `github.token`,
with job-scoped `packages: write`. Build jobs also have `contents: read` for
checkout; manifest-only jobs need no source access. The two reusable-workflow
callers explicitly permit those scopes on their publishing job, since callees
cannot elevate the caller's token. No GHCR personal-token secrets are declared or
forwarded. The release browser-version probe retains its read-only package scope.

After all nine packages granted this repository Admin under Manage Actions
access, the [2026-11-12 token proof](https://github.com/browserless/browserless/actions/runs/43238389609)
copied existing published manifests with `docker buildx imagetools create` using
only `github.token` on `ubuntu-slim`. Every package passed both the push and
cleanup: `base`, `chromium`, `chrome`, `edge`, `firefox`, `webkit`, `webkit-heavy`,
`multi`, and `multi-heavy`.

Only the disposable `gh-token-auth-test` tags were written. Unique index
annotations created isolated versions so deleting them could not delete a
version shared by production tags. Cleanup checked that each version was new and
had only the test tag, deleted it with the same workflow token, then confirmed
the tag was absent. No `latest` or `v2.*` tag was modified and no image was built.
The temporary workflow was removed and the lockfile regenerated after the proof.
This proves registry access and client-only manifest operations, not a full
production build/publish. Any future write probe or access-setting change still
requires separate approval.

## Runner allocation

`ubuntu-slim` runs lint, lockfile, zizmor, actionlint, PR title/format checks,
the Node updater, automerge, stale maintenance, the release-please API job, and
Docker manifest merge jobs. Manifest merging uses installed Docker client/Buildx
`imagetools` commands without a daemon. Lint retries are bounded to fit the
15-minute job budget; the security tools have ten-minute budgets.

Keep Docker builds/tests and the release browser-version probe on VM runners:
they require a Docker daemon. Keep leak-check on a VM for browser execution,
memory, and runtime requirements. CodeQL and npm publishing retain VM runners
for substantial analysis/build/prepack work. Validate slim jobs on GitHub before
making their check contexts required; local static checks do not prove hosted
image tooling, resource budgets, or publishing behavior.

## Administrator rollout checklist

These are manual steps, **not applied by this change**. This repository is not
on GitHub Enterprise Cloud; the pilot uses normal enforcement, not Evaluate mode.

- [ ] Review and merge the file changes through an authorized PR. Confirm all
      four reusable lint jobs run on PRs, including fork PRs, without write tokens
      or repository secrets. Check slim tooling and time budgets on hosted CI.
- [ ] In branch protection/rulesets, require the exact successful check contexts
      reported by GitHub for `lockfile`, `zizmor`, and `actionlint` (normally nested
      under the caller's `lint` job). Do not guess display names or remove existing
      browser/lint requirements. If using a merge queue, first add and test the
      necessary `merge_group` trigger so required checks also report there.
- [ ] Restrict allowed actions to the inventory above, including any required
      treatment of same-repository reusable workflows. Check effective org policy
      and other repositories before changing an organization-level setting; prefer
      repository scope for this pilot. Avoid broad third-party owner wildcards.
- [ ] Confirm that GitHub exposes **Require lockfile** for this repository and
      that every workflow on the default branch has valid coverage. If unavailable,
      retain the required verification check and record the platform limitation.
- [ ] Pilot Require lockfile on this repository only, with a maintainer available
      to revert the setting. After enabling it, observe a normal PR/Dependabot
      update and the next authorized release/publish; verify local reusable calls
      and all release workflows still resolve. Do not trigger publishing merely
      to test this setting without approval.
- [ ] Record the previous settings and rollback owner. If enforcement blocks
      legitimate workflows, restore only the pilot setting while fixing coverage;
      keep the lockfile and validation checks. No package-access changes belong
      in this rollout.
