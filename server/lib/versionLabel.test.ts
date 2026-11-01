import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import notificationManager, { Notification } from '@server/lib/notifications';
import type { NotificationPayload } from '@server/lib/notifications/agents/agent';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import {
  requestNotificationLabel,
  requestVersionLabel,
  standardLabelFrom,
  versionLabelFrom,
  withVersion,
} from '@server/lib/versionLabel';

const servers = [
  { id: 0, name: 'Radarr', buttonLabel: undefined },
  { id: 1, name: 'Radarr RU', buttonLabel: 'Russian' },
  { id: 2, name: 'Radarr LT', buttonLabel: '  ' },
];

describe('versionLabelFrom', () => {
  it('uses the button label of the requested version', () => {
    assert.strictEqual(
      versionLabelFrom(
        { type: MediaType.MOVIE, isServiceRequest: true, serverId: 1 },
        servers
      ),
      'Russian'
    );
  });

  it('falls back to the server name when the button label is blank', () => {
    assert.strictEqual(
      versionLabelFrom(
        { type: MediaType.MOVIE, isServiceRequest: true, serverId: 2 },
        servers
      ),
      'Radarr LT'
    );
  });

  it('returns nothing for a standard request', () => {
    assert.strictEqual(
      versionLabelFrom(
        { type: MediaType.MOVIE, isServiceRequest: false, serverId: 1 },
        servers
      ),
      undefined
    );
  });

  it('returns nothing for a server that no longer exists', () => {
    assert.strictEqual(
      versionLabelFrom(
        { type: MediaType.MOVIE, isServiceRequest: true, serverId: 9 },
        servers
      ),
      undefined
    );
  });
});

describe('standardLabelFrom', () => {
  const withVersions = [
    {
      id: 0,
      name: 'Radarr',
      isDefault: true,
      is4k: false,
      activeProfileId: 14,
    },
    { id: 1, name: 'Radarr RU', buttonLabel: 'Russian', is4k: false },
  ];
  const standard = (profileId?: number) => ({
    type: MediaType.MOVIE,
    isServiceRequest: false,
    serverId: 0,
    profileId,
  });

  it('names a standard request once the server has versions', () => {
    assert.strictEqual(standardLabelFrom(standard(), withVersions), 'Standard');
  });

  it('adds a profile that is not the server default', () => {
    assert.strictEqual(
      standardLabelFrom(standard(13), withVersions, 'Anime dub-only'),
      'Standard (Anime dub-only)'
    );
  });

  it('leaves out the default profile', () => {
    assert.strictEqual(
      standardLabelFrom(standard(14), withVersions, 'Anime subs-until-dub'),
      'Standard'
    );
  });

  it('keeps Seerr wording without versions', () => {
    assert.strictEqual(
      standardLabelFrom(standard(13), [withVersions[0]], 'Anime dub-only'),
      undefined
    );
  });

  it('never labels a version request as standard', () => {
    assert.strictEqual(
      standardLabelFrom(
        { type: MediaType.MOVIE, isServiceRequest: true, serverId: 1 },
        withVersions
      ),
      undefined
    );
  });
});

describe('withVersion', () => {
  it('appends the version name', () => {
    assert.strictEqual(
      withVersion('Movie Request Approved', 'Russian'),
      'Movie Request Approved in Russian'
    );
  });

  it('leaves the event unchanged without a version', () => {
    assert.strictEqual(
      withVersion('Movie Request Approved', undefined),
      'Movie Request Approved'
    );
  });
});

describe('request notifications name the version', () => {
  const sent: { type: Notification; event?: string }[] = [];

  beforeEach(() => {
    sent.length = 0;
    const settings = getSettings();
    settings.radarr = [
      { id: 0, name: 'Radarr' },
      { id: 1, name: 'Radarr RU', buttonLabel: 'Russian' },
    ] as RadarrSettings[];
    settings.sonarr = [
      { id: 0, name: 'Sonarr' },
      { id: 1, name: 'Sonarr RU', buttonLabel: 'Russian' },
    ] as SonarrSettings[];
    mock.method(
      notificationManager,
      'sendNotification',
      (type: Notification, payload: NotificationPayload) => {
        sent.push({ type, event: payload.event });
      }
    );
    // TheMovieDb methods are class fields, so stub them on the prototype.
    for (const [name, value] of [
      ['getMovie', { title: 'Runner', release_date: '2026-01-01' }],
      ['getTvShow', { name: 'Bluey', first_air_date: '2018-10-01' }],
    ] as const) {
      Object.defineProperty(TheMovieDb.prototype, name, {
        get: () => async () => value,
        set() {},
        configurable: true,
      });
    }
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().radarr = [];
    getSettings().sonarr = [];
  });

  const request = (
    type: MediaType,
    isServiceRequest: boolean,
    serverId?: number
  ) =>
    Object.assign(new MediaRequest(), {
      type,
      is4k: false,
      isServiceRequest,
      serverId,
      seasons: [],
    });
  const media = { tmdbId: 1 } as Media;

  it('says "in Russian" when a movie is requested in Russian', async () => {
    await MediaRequest.sendNotification(
      request(MediaType.MOVIE, true, 1),
      media,
      Notification.MEDIA_AUTO_APPROVED
    );
    assert.deepStrictEqual(sent, [
      {
        type: Notification.MEDIA_AUTO_APPROVED,
        event: 'Movie Request Automatically Approved in Russian',
      },
    ]);
  });

  it('says "in Russian" when a series request waits for approval', async () => {
    await MediaRequest.sendNotification(
      request(MediaType.TV, true, 1),
      media,
      Notification.MEDIA_PENDING
    );
    assert.deepStrictEqual(sent, [
      {
        type: Notification.MEDIA_PENDING,
        event: 'New Series Request in Russian',
      },
    ]);
  });

  it('says "in Standard" for a standard request', async () => {
    await MediaRequest.sendNotification(
      request(MediaType.MOVIE, false, 0),
      media,
      Notification.MEDIA_APPROVED
    );
    assert.deepStrictEqual(sent, [
      {
        type: Notification.MEDIA_APPROVED,
        event: 'Movie Request Approved in Standard',
      },
    ]);
  });

  it('keeps the Seerr wording when no server has versions', async () => {
    getSettings().radarr = [{ id: 0, name: 'Radarr' }] as RadarrSettings[];
    await MediaRequest.sendNotification(
      request(MediaType.MOVIE, false, 0),
      media,
      Notification.MEDIA_APPROVED
    );
    assert.deepStrictEqual(sent, [
      { type: Notification.MEDIA_APPROVED, event: 'Movie Request Approved' },
    ]);
  });

  it('names the profile when the arr cannot be reached', async () => {
    getSettings().radarr = [
      {
        id: 0,
        name: 'Radarr',
        hostname: '127.0.0.1',
        port: 1,
        apiKey: 'x',
        useSsl: false,
        activeProfileId: 14,
        isDefault: true,
        is4k: false,
      },
      { id: 1, name: 'Radarr RU', buttonLabel: 'Russian' },
    ] as RadarrSettings[];
    assert.strictEqual(
      await requestNotificationLabel({
        type: MediaType.MOVIE,
        isServiceRequest: false,
        serverId: 0,
        profileId: 13,
      }),
      'Standard'
    );
  });

  it('reads the version from the current settings', () => {
    assert.strictEqual(
      requestVersionLabel({
        type: MediaType.TV,
        isServiceRequest: true,
        serverId: 1,
      }),
      'Russian'
    );
  });
});
