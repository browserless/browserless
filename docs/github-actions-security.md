# GitHub Actions security maintenance

## Tool update procedure

Tool pins live in `.github/workflows/lint.yml` and require manual updates;
Dependabot's Actions updates do not maintain these shell-installed tools.

- **gh-actions-lock v0.4.1:** review the release, then update the extension
  installation's `--pin` value. This installation has no separate checksum in
  the workflow. Use the same version locally when regenerating the lockfile.
- **zizmor 1.32.0, actionlint 1.7.12, ShellCheck 0.11.0:** review each release,
  download the matching Linux x86-64 archive, and verify its digest against the
  publisher's checksum/signature where available. Update the version in the
  step name, archive URL, extraction path if changed, and literal SHA-256 in
  `sha256sum --check` together. Keep zizmor at least 1.32.0 for lockfile support.

After adding/removing a workflow or changing action references, regenerate
`.github/workflows/actions.lock` **after** all workflow edits, then verify from
the repository root with the pinned tools and ShellCheck on PATH:

```sh
gh actions-lock
gh actions-lock --verify
zizmor .
actionlint
```

Review the generated refs, repository identities, and commit hashes; commit the
workflow and lockfile together. Never hand-edit the lockfile. Run the PR checks
after a tool upgrade and revisit the exceptions below.

## Exceptions

- **`.github/actionlint.yaml`:** the exact unknown-label pattern for
  `ubuntu-26.04` and `ubuntu-26.04-arm` compensates for actionlint 1.7.12's stale
  runner metadata. Remove it when the pinned version recognizes both labels;
  other runner-label errors remain fatal. Separately, 1.7.12 skips remote-action
  input schemas at full-semver refs: there is no input-error suppression, but
  those inputs need review against the pinned action's `action.yml`.
- **`.github/zizmor.yml`, `dependabot-cooldown.config.days: 3`:** enforce the
  approved three-day minimum for npm and GitHub Actions rather than zizmor's
  default seven. Lowering either cooldown fails CI. Remove this override if
  the policy adopts the analyzer's default minimum.
  `lint.yml` also checks every non-Docker updater explicitly: zizmor 1.32.0
  stops at its first compliant updater. Remove that workaround only after
  upgrading and confirming that lowering GitHub Actions alone to zero fails.
- **Same rule, `dependabot.yml:28`:** Docker has **no configured cooldown**.
  The retained narrow exception is currently redundant: zizmor 1.32.0 models
  omitted cooldowns as three days. It does not enforce an explicit Docker delay.
  Remove it when an approved Docker cooldown is configured.

Keep the Docker ignore tied to its finding if Dependabot line numbers move.
Do not broaden it to hide new ecosystems or unrelated diagnostics.
