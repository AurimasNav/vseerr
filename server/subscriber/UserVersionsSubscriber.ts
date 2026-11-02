import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import {
  getDefaultVersions,
  sanitizeVersions,
  setUserVersions,
} from '@server/lib/versions';
import logger from '@server/logger';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { EventSubscriber } from 'typeorm';

// Users are created in several places (Plex, Jellyfin and local sign-in,
// imports, the users API). Storing their versions after the insert covers
// all of them without changing each one: versions given to `new User()`
// are kept, otherwise the user gets the default versions.
@EventSubscriber()
export class UserVersionsSubscriber implements EntitySubscriberInterface<User> {
  public listenTo(): typeof User {
    return User;
  }

  public async afterInsert(event: InsertEvent<User>): Promise<void> {
    const user = event.entity;
    if (!user?.id) {
      return;
    }

    const given = sanitizeVersions(user.requestServices, getSettings());
    const versions = given.length > 0 ? given : getDefaultVersions();
    if (versions.length === 0) {
      return;
    }

    // In a savepoint inside the transaction that saves the user (a
    // transaction of its own when there is none). On Postgres a failed
    // statement aborts the whole transaction, so without the savepoint a
    // failed insert here would still fail the sign-in at commit, even
    // though the error is caught.
    const queryRunner = event.queryRunner;
    let open = false;
    try {
      await queryRunner.startTransaction();
      open = true;
      user.requestServices = await setUserVersions(
        user.id,
        versions,
        queryRunner.manager
      );
      await queryRunner.commitTransaction();
      open = false;
    } catch (e) {
      if (open) {
        await queryRunner.rollbackTransaction();
      }
      user.requestServices = [];
      logger.error('Failed to store the versions of a new user', {
        label: 'Versions',
        userId: user.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
