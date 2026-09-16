# Releases

The four public packages (`schema`, `sdk`, `mcp`, `vite`) use a fixed Changesets
release group. Apps and the workspace root remain private. Package archives
contain built entry points, README and LICENSE; the SDK also includes bundled
third-party license notices.

## Beta versions

The first beta is **1.0.0-beta.0** and uses the npm **beta** dist-tag. While
`.changeset/pre.json` is in beta mode, Changesets increments the prerelease
number. Keep ordinary change descriptions in `.changeset/*.md`.

```sh
vp run changeset
```

The release workflow validates the repository and opens a version pull request
when pending changesets are found. Review and merge that PR to publish the next
version. The `version-packages` script also formats generated changelogs so the
version PR passes the repository's formatting checks. Stable releases require explicitly exiting prerelease mode in a reviewed
change:

```sh
vp exec changeset pre exit
vp run version-packages
```

This produces `1.0.0` from the beta series; stable publishing uses `latest`.
For a brand-new package, npm also initializes a `latest` tag and rejects its
removal. Until a stable release exists, that alias can therefore point to a beta.
This does not change the SemVer prerelease version. Installation instructions
explicitly use `@beta`. The publish script sets `beta` or `latest` in the Changesets
publish plan based on the actual version, then packs and publishes that plan, so
future beta releases continue to update `beta` even when the initial alias exists.

## One-time npm bootstrap

New npm packages must be published once with an authenticated maintainer account
before their Trusted Publisher settings can be configured. Authenticate in a
terminal outside this workspace (`npm login`), then publish the reviewed version:

```sh
vp run build:packages
vp run release:check
node scripts/publish-packages.mjs
git push --follow-tags
```

Run the initial publish in an interactive terminal and complete npm's 2FA prompt
there. The wrapper explicitly sets prerelease entries to `beta` before packing
and publishing. Do not pass `--tag` to Changesets while pre mode is active;
Changesets rejects that combination.

For each package, configure npm Settings → Trusted Publisher:

- Provider: GitHub Actions
- Organization/user: `nightire`
- Repository: `ainotation`
- Workflow filename: `release.yml`
- Environment: leave empty
- Allow direct `npm publish` (not only staged publishing)

Then set the GitHub repository variable `NPM_TRUSTED_PUBLISHING=true`. The workflow
uses `id-token: write` and GitHub-hosted runners; no npm write token is stored in
GitHub. npm automatically creates provenance for these public OIDC publishes.
The initial local bootstrap publish does not have a GitHub provenance attestation.

The workflow invokes `vp run --no-cache release`. Publishing must never replay a
cached result; disabling the task cache also preserves the GitHub OIDC request
environment and `CHANGESETS_OUTPUT` used to create tags and GitHub releases.

Enable “Allow GitHub Actions to create and approve pull requests” in repository
Actions settings so Changesets can create version PRs. The action's default token
is used; release jobs have scoped permissions. Actions are pinned to reviewed
commit SHAs.

## Validation

```sh
vp run ready
vp run release:check
```

`release:check` packs all public packages, validates their exports and resolved
dependency versions, then installs their tarballs into an isolated temporary
consumer and checks ESM imports and TypeScript declarations. It requires registry
access for public dependencies and removes the temporary consumer when done.

CI keeps service, Vite access-control and package validation on Linux. SDK and
Playground browser interactions, native screenshot capture and touch input run on
macOS Chrome, matching the verified capture environment. Both jobs must pass
before the release workflow proceeds; no browser tests are skipped.

New releases include the MIT License and use the `MIT` SPDX identifier in package
metadata. Prepack copies the root license into each public package; `release:check`
verifies both the identifier and the complete license text in every archive.
Bundled third-party notices remain included under their original licenses.

The previously published `1.0.0-beta.0` and `1.0.0-beta.1` archives retain the
earlier license. Publish the MIT transition as a new version rather than replacing
existing archives or rewriting historical changelog entries.
