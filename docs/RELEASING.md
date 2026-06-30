# Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please).
A merge of the **Release PR** publishes the npm package **and** all Docker images
together, on the same version. Day-to-day you only review and merge a PR.

## The flow

```text
commits land on main (Conventional Commits)
        │
        ▼
release-please.yml  ──►  opens / updates a single draft "Release PR"
        │                 (bumps package.json, regenerates CHANGELOG.md,
        │                  updates .release-please-manifest.json)
        │                 + commits the auto-generated "Supports the following
        │                   libraries and browsers:" block into CHANGELOG.md
        │
        ▼  (review/edit on the PR, mark ready, then merge — NOT auto-merged)
merge Release PR  ──►  release-please creates GitHub Release + tag  vX.Y.Z
        │
        ├──►  npm-publish.yml          (on v*.*.*)  ── npm publish + Slack
        └──►  docker-publish-stable.yml (on v2.*)   ── multi-arch Docker images
```

`docker-publish-latest.yml` is unchanged: it still publishes the `latest` Docker
tag on every push to `main`, independent of versioned releases.

## How versioning works

release-please derives the next version and the changelog from
[Conventional Commit](https://www.conventionalcommits.org/) messages since the
last release:

| Commit prefix                                                | Changelog section        | Version bump |
| ------------------------------------------------------------ | ------------------------ | ------------ |
| `feat:`                                                      | Features                 | minor        |
| `fix:`                                                       | Bug Fixes                | patch        |
| `perf:`                                                      | Performance Improvements | patch        |
| `revert:`                                                    | Reverts                  | patch        |
| `feat!:` / `BREAKING CHANGE:`                                | (highlighted)            | major        |
| `build:`/`chore:`/`ci:`/`docs:`/`style:`/`refactor:`/`test:` | hidden                   | none         |

**Use squash-merge with a Conventional-Commit PR title.** The squashed commit
subject is what release-please parses, so a clean title (e.g.
`fix: serve /function via local address`) keeps the version bump and changelog
accurate. Anything miscategorized can still be fixed by hand on the Release PR.

## Editing the changelog before release (the manual window)

The Release PR opens as a **draft** (`draft-pull-request: true`) and is never
auto-merged — the open PR is your editing window. GitHub will not let a draft PR
be merged, so a release cannot ship until you explicitly mark it ready:

1. release-please keeps `CHANGELOG.md` up to date on the PR branch from commit
   messages. Reword or reorder entries directly on that branch as needed.
2. The `browser-versions` job commits the **browser & library versions block**
   into the newest section of `CHANGELOG.md`, regenerated from
   `ghcr.io/browserless/multi:latest` (linux/amd64). It refreshes both on push to
   `main` and once the new `multi:latest` finishes building (a `workflow_run` on
   the latest-image publish), so even if the push-time insert used a slightly
   older image, the block automatically converges to the shipping versions — no
   extra push and no manual paste. It is idempotent (wrapped in
   `<!-- browser-versions:start/end -->` markers).
3. When the changelog looks right, **mark the PR ready for review and merge it**.
   That creates the tag and triggers the npm + Docker publishes.

You can regenerate the versions block yourself at any time:

```bash
npm run changelog:versions
# or against a specific image / platform:
node scripts/changelog-browser-versions.js --image ghcr.io/browserless/multi:v2.51.0 --platform linux/amd64
```

It runs the `multi` image, reads puppeteer/playwright versions from
`package.json`, and launches every browser via Playwright to read
`browser.version()` straight from the binary. Chrome and Edge are amd64 only
(their stable channels are not built for arm64); chromium/firefox/webkit are
pinned by Playwright and identical across architectures.

## Required repository configuration

| Secret / variable                                 | Used by            | Purpose                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vars.BROWSERLESS_ACTIONS_CLIENT_ID`              | release-please.yml | GitHub App client id (mints a token so the tag it creates can trigger downstream workflows).                                                                                                                                                                                                     |
| `secrets.BROWSERLESS_ACTIONS_APP_PRIVATE_KEY`     | release-please.yml | GitHub App private key.                                                                                                                                                                                                                                                                          |
| npm **trusted publishing** (OIDC)                 | npm-publish.yml    | Lets `npm publish` authenticate via `id-token: write` with no `NODE_AUTH_TOKEN`, and attaches provenance. Configure on npmjs.com for `@browserless.io/browserless` → this repo + `npm-publish.yml`. (Alternatively add an `NPM_TOKEN` secret and an `env: NODE_AUTH_TOKEN` to the publish step.) |
| `secrets.SLACK_RELEASES_WEBHOOK`                  | npm-publish.yml    | Slack incoming webhook for the publish notification.                                                                                                                                                                                                                                             |
| `secrets.GHCR_USERNAME` / `secrets.GHCR_PASSWORD` | docker-publish.yml | Existing — push Docker images to GHCR.                                                                                                                                                                                                                                                           |

The GitHub App used by `release-please.yml` needs **contents: write** and
**pull-requests: write** on this repository.

## First release after enabling

`.release-please-manifest.json` is seeded with the last released version
(`2.51.0`), so the first Release PR computes the next bump from commits landed
since the `v2.51.0` tag.
release-please prepends its own changelog entries above the existing history;
older `CHANGELOG.md` entries are preserved untouched.
