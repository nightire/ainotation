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
version. Stable releases require explicitly exiting prerelease mode in a reviewed
change:

```sh
vp exec changeset pre exit
vp run version-packages
```

This produces `1.0.0` from the beta series; stable publishing uses `latest`.
Do not manually put beta versions on `latest`.

For a brand-new package, npm may also initialize a `latest` tag when publishing
its first prerelease. After the bootstrap publish, check `npm dist-tag ls` for
each package and remove that automatically created `latest` tag with
`npm dist-tag rm @ainotation/<package> latest` in an interactive terminal outside
the workspace. Keep `beta: 1.0.0-beta.0`; no package version is removed.

## One-time npm bootstrap

New npm packages must be published once with an authenticated maintainer account
before their Trusted Publisher settings can be configured. Authenticate in a
terminal outside this workspace (`npm login`), then publish the reviewed version:

```sh
vp run build:packages
vp run release:check
vp exec changeset publish
git push --follow-tags
```

Run the initial publish in an interactive terminal and complete npm's 2FA prompt
there. Changesets may show a generic warning about `latest` for legacy prerelease
packages; the actual publish plan must show `tag: beta` for this release. Inspect
it with `vp exec changeset publish-plan`. Do not pass `--tag` while pre mode is
active; Changesets rejects that combination.

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

All releases include the source-available Ainotation Development and
Non-Commercial License. Internal development is free; commercial distribution,
hosted services and production integration require separate written authorization.
