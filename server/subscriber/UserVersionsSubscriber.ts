import { User } from '@server/entity/User';
import {
  getDefaultVersions,
  setUserVersions,
  wellFormedVersions,
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

    const given = wellFormedVersions(user.requestServices);
    const versions = given.length > 0 ? given : getDefaultVersions();
    if (versions.length === 0) {
      return;
    }

    try {
      user.requestServices = await setUserVersions(
        user.id,
        versions,
        event.manager
      );
    } catch (e) {
      logger.error('Failed to store the versions of a new user', {
        label: 'Versions',
        userId: user.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
