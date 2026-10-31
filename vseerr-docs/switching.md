# Switching between Seerr and VSeerr

VSeerr and Seerr can use the same database and the same `settings.json`. You can move from Seerr to VSeerr, and back, without exporting anything.

VSeerr is provided as is, without warranty of any kind (see [LICENSE](../LICENSE)). **Back up your config folder, and your Postgres database if you use one, before every switch.** See Seerr's [backup guide](https://docs.seerr.dev/using-seerr/backups).

## How VSeerr stores its data

VSeerr keeps everything it adds in tables of its own, all named `vseerr_*`:

| Table | Holds |
| --- | --- |
| `vseerr_version_request` | Which requests are version requests |
| `vseerr_user_version` | Which versions each user may request |
| `vseerr_service_status` | Availability of each title in each version |
| `vseerr_parked_request` | Version requests set aside while Seerr uses the database |

It does not add columns to Seerr's tables, and its tables have no foreign keys to them. Seerr ignores these tables, and Seerr's own database updates never touch them.

Version names and default versions are stored in `settings.json`, in the Radarr and Sonarr server entries (`buttonLabel`, `animeOnly`) and in `main.defaultRequestServices`. Seerr keeps these keys when it loads the file.

## Version requirement

Use a VSeerr release built on the same Seerr version as the one you run, or a newer one. When going back, use the Seerr version VSeerr was built on, or a newer one. Each VSeerr release names the Seerr version it is built on.

## From Seerr to VSeerr

1. Stop Seerr and back up.
2. Start VSeerr with the same config folder, or the same `DB_*` settings for Postgres.

On first start VSeerr creates its tables. Existing requests, users and settings are not changed. To use versions, give your Radarr and Sonarr servers a version name under **Settings → Services**, then choose which users may request them.

## From VSeerr to Seerr

Version requests are ordinary rows in Seerr's request table. Seerr would see them as normal requests: it would show them without their version and could block normal requests for the same title. So set them aside first:

1. Stop VSeerr and back up.
2. Park the version requests. Run this with the VSeerr image (or in the VSeerr folder for a source install), with the same config folder and, for Postgres, the same `DB_TYPE` and `DB_*` variables as VSeerr:

   ```sh
   NODE_ENV=production node dist/scripts/vseerrDatabase.js park
   ```

   With Docker, for example: `docker run --rm -v /path/to/config:/app/config <vseerr image> node dist/scripts/vseerrDatabase.js park`. The image already sets `NODE_ENV=production`.

3. Start Seerr with the same config folder or database.

Seerr then sees only its own requests. Users, ordinary requests and settings work as before. Everything in Radarr and Sonarr stays as it is; parking only changes the database.

## Back to VSeerr

Start VSeerr. On start it:

- puts parked version requests back, with their seasons and original ids,
- re-creates the title entry of a parked request if Seerr removed it,
- drops parked requests whose user was deleted in Seerr,
- re-creates any VSeerr table that is missing, for example after restoring only Seerr's tables,
- removes version data that points to deleted requests, titles or users.

## Removing VSeerr's data

To leave a plain Seerr database, with nothing from VSeerr in it:

```sh
NODE_ENV=production node dist/scripts/vseerrDatabase.js remove --yes
```

This deletes version requests and drops the `vseerr_*` tables. Ordinary requests are kept. `status` shows what VSeerr has stored without changing anything.

## Things to know

- **Editing a server in Seerr removes its version name.** Seerr does not know the version fields, so saving a Radarr or Sonarr server in Seerr's settings drops them. Set the name again in VSeerr. Other settings are not affected.
- **Seerr's availability sync** only updates Seerr's own status for each title. Version availability is updated again by VSeerr's next scan.
- **Requests made in Seerr** while it uses the database stay ordinary requests after switching back.

## How this is tested

The `VSeerr Database Round Trip` workflow runs on every pull request, on SQLite and Postgres:

Seerr creates a database → VSeerr adds version requests → park → Seerr adds a request → VSeerr restores → VSeerr data removed → Seerr opens the database again.

Each step checks that no request is lost and that each side starts on what the other left behind. The daily upstream check runs the same test against every new Seerr release. To run it yourself: `pnpm vseerr:roundtrip`.
