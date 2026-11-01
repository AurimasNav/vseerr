import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import { coverageBlock, getMediaVersions } from '@server/lib/mediaVersions';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';

const FORMATS = [
  { id: 1, name: 'REMUX' },
  { id: 2, name: 'Russian audio' },
  { id: 3, name: 'Lithuanian audio' },
];
const PROFILE = {
  id: 1,
  name: 'Any',
  minFormatScore: 0,
  formatItems: [
    { format: 1, name: 'REMUX', score: 45 },
    { format: 2, name: 'Russian audio', score: 10 },
    { format: 3, name: 'Lithuanian audio', score: 20 },
  ],
};

type Fake = Record<string, unknown>;
const hosts: Record<string, Fake> = {};

// Fake Radarr/Sonarr: answer GETs from `hosts` by hostname and path.
const realAdapter = axios.defaults.adapter;
beforeEach(() => {
  axios.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = new URL(
      (config.baseURL ?? '') + (config.url ?? ''),
      'http://x'
    );
    const fake = hosts[url.hostname] ?? {};
    const path = url.pathname.replace(/^\/api\/v3/, '');
    const data =
      path in fake
        ? fake[path]
        : path === '/customformat'
          ? FORMATS
          : path === '/qualityprofile'
            ? [PROFILE]
            : [];
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    } as never;
  };
  cacheManager.getCache('radarr').flush();
  cacheManager.getCache('sonarr').flush();
  for (const key of Object.keys(hosts)) delete hosts[key];
});
afterEach(() => {
  axios.defaults.adapter = realAdapter;
});

const radarr = (
  id: number,
  hostname: string,
  over: Partial<RadarrSettings> = {}
): RadarrSettings =>
  ({
    id,
    name: hostname,
    hostname,
    port: 7878,
    apiKey: 'key',
    useSsl: false,
    activeProfileId: 1,
    activeProfileName: 'Any',
    activeDirectory: '/movies',
    is4k: false,
    minimumAvailability: 'released',
    tags: [],
    isDefault: id === 0,
    syncEnabled: true,
    preventSearch: false,
    ...over,
  }) as RadarrSettings;

const movieFile = (formatIds: number[], languages = ['English']) => ({
  quality: { quality: { resolution: 2160 } },
  customFormats: formatIds.map((id) => FORMATS[id - 1]),
  languages: languages.map((name, i) => ({ id: i + 1, name })),
});

const hasMovie = (host: string, formatIds: number[] | null) => {
  hosts[host] = {
    '/movie': [
      {
        id: 7,
        qualityProfileId: 1,
        hasFile: formatIds !== null,
        originalLanguage: { id: 1, name: 'English' },
      },
    ],
    '/moviefile': formatIds ? [movieFile(formatIds)] : [],
  };
};

setupTestDb();

const seedMovie = async () =>
  getRepository(Media).save(
    new Media({ mediaType: MediaType.MOVIE, tmdbId: 603, serviceId: 0 })
  );

describe('getMediaVersions', () => {
  beforeEach(() => {
    getSettings().radarr = [
      radarr(0, 'radarr', {
        definingFormats: ['REMUX'],
        definingMatch: 'any',
      }),
      radarr(1, 'radarr-ru', {
        buttonLabel: 'Russian',
        definingFormats: ['Russian audio'],
      }),
    ];
  });

  it('summarises each version and marks Russian covered', async () => {
    hasMovie('radarr', [1, 2]);
    hasMovie('radarr-ru', null);
    const media = await seedMovie();

    const { versions } = await getMediaVersions(media);

    assert.deepStrictEqual(
      versions.map((v) => [v.key, v.label]),
      [
        ['standard', undefined],
        ['radarr:1', 'Russian'],
      ]
    );
    assert.deepStrictEqual(
      versions[0].summary?.formats.map((f) => f.name),
      ['REMUX', 'Russian audio']
    );
    assert.deepStrictEqual(versions[0].summary?.resolutions, ['2160p']);
    assert.deepStrictEqual(versions[1].coverage.coveredBy, { key: 'standard' });
    assert.strictEqual(versions[1].summary, undefined);
  });

  it('never lets an unreachable version cover another', async () => {
    hosts['radarr'] = { '/customformat': null };
    hasMovie('radarr-ru', [2]);
    const media = await seedMovie();

    const { versions } = await getMediaVersions(media);

    assert.strictEqual(versions[0].coverage.coveredBy, undefined);
    assert.strictEqual(versions[1].coverage.coveredBy, undefined);
  });

  it('returns nothing with a single server', async () => {
    getSettings().radarr = [radarr(0, 'radarr')];
    const media = await seedMovie();
    assert.deepStrictEqual(await getMediaVersions(media), { versions: [] });
  });
});

describe('coverageBlock', () => {
  beforeEach(() => {
    getSettings().radarr = [
      radarr(0, 'radarr', { definingFormats: ['REMUX'] }),
      radarr(1, 'radarr-ru', {
        buttonLabel: 'Russian',
        definingFormats: ['Russian audio'],
      }),
      radarr(2, 'radarr-lt', { buttonLabel: 'Lithuanian' }),
    ];
  });

  it('blocks a covered version', async () => {
    hasMovie('radarr', [1, 2]);
    const media = await seedMovie();
    const block = await coverageBlock({
      media,
      serverId: 1,
      isServiceRequest: true,
    });
    assert.match(block?.message ?? '', /through Standard/);
  });

  it('never blocks a version without defining formats', async () => {
    hasMovie('radarr', [1, 2, 3]);
    const media = await seedMovie();
    assert.strictEqual(
      await coverageBlock({ media, serverId: 2, isServiceRequest: true }),
      undefined
    );
  });

  it('blocks for a day after another version is requested', async () => {
    const user = await getRepository(User).findOneOrFail({ where: { id: 1 } });
    const media = await seedMovie();
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: user,
        status: MediaRequestStatus.PENDING,
      })
    );
    const loaded = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
      relations: { requests: true },
    });

    const fresh = await coverageBlock({
      media: loaded,
      serverId: 1,
      isServiceRequest: true,
    });
    assert.match(fresh?.message ?? '', /just requested in Standard/);

    const later = new Date(
      new Date(request.createdAt).getTime() + 25 * 60 * 60 * 1000
    );
    assert.strictEqual(
      await coverageBlock({
        media: loaded,
        serverId: 1,
        isServiceRequest: true,
        now: later,
      }),
      undefined
    );
  });
});

describe('coverageBlock (shows)', () => {
  it('lists the seasons another version covers', async () => {
    getSettings().sonarr = [
      {
        id: 0,
        name: 'sonarr',
        hostname: 'sonarr',
        port: 8989,
        apiKey: 'key',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'Any',
        activeDirectory: '/tv',
        activeLanguageProfileId: 1,
        is4k: false,
        enableSeasonFolders: true,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tags: [],
        animeTags: [],
      },
      {
        id: 1,
        name: 'sonarr-ru',
        hostname: 'sonarr-ru',
        port: 8989,
        apiKey: 'key',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'Any',
        activeDirectory: '/tv-ru',
        activeLanguageProfileId: 1,
        is4k: false,
        enableSeasonFolders: true,
        isDefault: false,
        syncEnabled: true,
        preventSearch: false,
        tags: [],
        animeTags: [],
        buttonLabel: 'Russian',
        definingFormats: ['Russian audio'],
      },
    ] as unknown as SonarrSettings[];
    const episode = (season: number, formatIds: number[]) => ({
      seasonNumber: season,
      ...movieFile(formatIds),
    });
    hosts['sonarr'] = {
      '/series': [
        {
          id: 3,
          qualityProfileId: 1,
          seasons: [
            {
              seasonNumber: 1,
              statistics: { episodeCount: 2, episodeFileCount: 2 },
            },
            {
              seasonNumber: 2,
              statistics: { episodeCount: 2, episodeFileCount: 2 },
            },
          ],
        },
      ],
      '/episodefile': [
        episode(1, [2]),
        episode(1, [2]),
        episode(2, [2]),
        episode(2, []),
      ],
    };
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 1399,
        tvdbId: 121361,
        serviceId: 0,
      })
    );

    const block = await coverageBlock({
      media,
      serverId: 1,
      isServiceRequest: true,
    });
    assert.deepStrictEqual(block?.seasons, [1]);
  });
});
