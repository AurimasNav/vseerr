// VSeerr database tool. Run it with VSeerr stopped:
//
//   NODE_ENV=production node dist/scripts/vseerrDatabase.js status
//   NODE_ENV=production node dist/scripts/vseerrDatabase.js park
//   NODE_ENV=production node dist/scripts/vseerrDatabase.js remove --yes
//
// `park` moves version requests out of Seerr's tables so Seerr does not
// treat them as ordinary requests. VSeerr puts them back when it starts.
// `remove` deletes everything VSeerr added, including version requests.
// Uses the same database settings (CONFIG_DIRECTORY, DB_TYPE, DB_*) as
// VSeerr itself. Back up the database first.
import dataSource from '@server/datasource';
import { VersionRequest } from '@server/entity/VSeerrVersions';
import {
  parkVersionRequests,
  purgeVersionData,
} from '@server/lib/versionDatabase';
import { PARKED_REQUEST_TABLE, VSEERR_TABLES } from '@server/lib/versionSql';

const usage = `Usage: vseerrDatabase <status|park|remove --yes>

  status   Show what VSeerr has stored in the database.
  park     Move version requests aside before starting Seerr on this
           database. VSeerr restores them the next time it starts.
  remove   Delete all VSeerr data and tables. Needs --yes.

Stop VSeerr and back up the database before park or remove.`;

const count = async (table: string): Promise<number> => {
  const [{ total }] = await dataSource.query(
    `SELECT COUNT(*) AS "total" FROM "${table}"`
  );
  return Number(total);
};

const main = async (): Promise<number> => {
  const [command, flag] = process.argv.slice(2);
  if (!['status', 'park', 'remove'].includes(command ?? '')) {
    // eslint-disable-next-line no-console
    console.log(usage);
    return command ? 1 : 0;
  }
  if (command === 'remove' && flag !== '--yes') {
    // eslint-disable-next-line no-console
    console.error('remove deletes all version data. Add --yes to confirm.');
    return 1;
  }

  // Outside production the SQLite settings sync the schema to VSeerr's
  // entities on connect, which must never happen to a live database.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('Run with NODE_ENV=production (already set in the image).');
    return 1;
  }

  await dataSource.initialize();
  try {
    const queryRunner = dataSource.createQueryRunner();
    const present: boolean[] = [];
    for (const table of VSEERR_TABLES) {
      present.push(await queryRunner.hasTable(table));
    }
    await queryRunner.release();
    if (!present.some(Boolean)) {
      // eslint-disable-next-line no-console
      console.log('No VSeerr data in this database.');
      return 0;
    }
    if (!present.every(Boolean) && command !== 'remove') {
      // eslint-disable-next-line no-console
      console.error(
        'Some VSeerr tables are missing. Start VSeerr once to repair them, or use remove.'
      );
      return 1;
    }

    if (command === 'status') {
      const lines = await Promise.all(
        VSEERR_TABLES.map(async (table) => `${table}: ${await count(table)}`)
      );
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'));
      return 0;
    }

    if (command === 'park') {
      const active = await dataSource.getRepository(VersionRequest).count();
      const parked = await parkVersionRequests(dataSource);
      // eslint-disable-next-line no-console
      console.log(
        `Parked ${parked} of ${active} version request(s). ${await count(PARKED_REQUEST_TABLE)} parked in total. Seerr can now use this database.`
      );
      return 0;
    }

    const removed = await purgeVersionData(dataSource);
    // eslint-disable-next-line no-console
    console.log(
      `Removed VSeerr's tables and ${removed} version request(s). The database is now plain Seerr.`
    );
    return 0;
  } finally {
    await dataSource.destroy();
  }
};

main().then(
  (code) => process.exit(code),
  (e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
