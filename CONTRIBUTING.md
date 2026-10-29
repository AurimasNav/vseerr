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
- **Additive database changes.** Add new tables or columns. Do not rename, repurpose or drop Seerr's. Every migration needs a SQLite and a PostgreSQL version.
- **Do not reformat Seerr's code.** Run the formatter on your own changes only.
- **No new kinds of stored credentials.**
- **One topic per pull request.**

## Branches

- `main` is VSeerr: the latest Seerr release plus VSeerr's changes. Open pull requests against `main`.
- Seerr releases are merged into `main` as they come out. A scheduled workflow checks each new release and opens an issue with the result.

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
