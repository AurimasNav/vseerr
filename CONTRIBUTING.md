# Contributing to VSeerr

Thank you for your interest in VSeerr. It is a small fork of [Seerr](https://github.com/seerr-team/seerr) with one goal: versions, kept in step with every Seerr release.

VSeerr is vibe coded, and AI-assisted contributions are welcome. Pull requests are judged on the code: it has to pass the checks and fit the scope below.

## What fits in VSeerr

VSeerr deliberately changes little, so that new Seerr releases merge cleanly.

**Welcome:**

- version features and fixes
- fixes for problems that exist only in VSeerr
- documentation, tests and project tooling for the above

**Please send to Seerr instead:**

- bugs that also exist in Seerr
- features unrelated to versions

Seerr has its own [contribution policy](https://github.com/seerr-team/seerr/blob/develop/CONTRIBUTING.md), which does not accept AI-driven contributions. VSeerr picks up Seerr's changes when Seerr releases them.

## Keeping changes small

- **New code in new files.** Put version code in new files where possible, and keep edits to existing Seerr files to small hooks that call into it. The fewer lines VSeerr changes in Seerr's files, the fewer conflicts each release brings.
- **Database changes go in VSeerr's own tables.** New data goes in new `vseerr_*` tables, never in columns or foreign keys on Seerr's tables, so the same database keeps working with Seerr (see [switching](vseerr-docs/switching.md)). Do not rename, repurpose or drop Seerr's tables. Every migration needs a SQLite and a PostgreSQL version.
- **Do not reformat Seerr's code.** Run the formatter on your own changes only.
- **No new kinds of stored credentials.**
- **One topic per pull request.**

## Branches

- `main` is VSeerr: the latest Seerr release plus VSeerr's changes. Open pull requests against `main`.
- Seerr releases are merged into `main` as they come out. A scheduled workflow checks each new release and opens an issue with the result.
- Merge a release with `bin/Merge-SeerrRelease.ps1` ([PowerShell 7.4](https://learn.microsoft.com/powershell/scripting/install/installing-powershell) or newer), the script the scheduled check uses. It keeps VSeerr's version of the files listed in `.github/vseerr-owned-files` and leaves the merge uncommitted for review:

  ```sh
  git switch -c seerr-v3.6.0 origin/main
  pwsh ./bin/Merge-SeerrRelease.ps1 -Tag v3.6.0
  ```

  Resolve any conflicts, commit, and open a pull request. Merge it with a merge commit, not squashed, so Seerr's history stays in `main`.

## Pull request titles and versions

Pull requests are squash-merged, so the title becomes the commit message on `main`. Write it as a [conventional commit](https://www.conventionalcommits.org/): the title type sets how much VSeerr's version goes up when the pull request is merged.

- `feat: ...` raises the minor version: 2.118.2 becomes 2.119.0.
- `fix: ...`, `chore: ...` or any other title raises the patch version: 2.118.2 becomes 2.118.3.
- `feat!: ...` (any type with `!`), or a `BREAKING CHANGE:` line in the description, raises the major version: 2.118.2 becomes 3.0.0. Use it when a change needs action from people who run VSeerr.

Images are tagged `<Seerr version>-vseerr.<VSeerr version>`, for example `3.5.1-vseerr.2.118.0`. VSeerr's version counts every commit on `main`, Seerr's included, so merging a Seerr release changes the first part and also raises the second by that release's own commits.

## Development

You need [Node.js](https://nodejs.org/en/download/) 22, [pnpm](https://pnpm.io/installation) and [Git](https://git-scm.com/downloads).

```bash
git clone https://github.com/AurimasNav/vseerr.git
cd vseerr
pnpm install
pnpm dev
```

Before opening a pull request, run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm i18n:extract   # if you changed any UI text
```

### Database migrations

Follow Seerr's [migration guide](https://github.com/seerr-team/seerr/blob/develop/CONTRIBUTING.md#migrations), with `main` in place of `develop`.

### UI text

Follow Seerr's [UI text style](https://github.com/seerr-team/seerr/blob/develop/CONTRIBUTING.md#ui-text-style).

## Translations

Seerr's translations are maintained on [Seerr's Weblate](https://translate.seerr.dev/projects/seerr/seerr-frontend/). Text added by VSeerr is in English for now.

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
