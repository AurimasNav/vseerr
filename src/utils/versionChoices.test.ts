import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getVersionChoices,
  holdsOtherVersion,
  initialVersionChoice,
  optionApplies,
  preferenceChanges,
  versionLoading,
  versionRequesters,
} from './versionChoices';

const services = [
  { id: 0, isDefault: true },
  { id: 1, buttonLabel: 'German' },
  { id: 2, buttonLabel: 'French' },
  { id: 3, buttonLabel: 'Anime', animeOnly: true },
] as ServiceCommonServer[];

const request = (
  userId: number,
  serverId?: number,
  status = MediaRequestStatus.PENDING
) => ({
  requestedBy: { id: userId },
  is4k: false,
  isServiceRequest: serverId !== undefined,
  serverId,
  status,
});

const media = (requests: ReturnType<typeof request>[]) =>
  ({
    status: MediaStatus.UNKNOWN,
    requests,
    serviceStatuses: [],
  }) as unknown as Media;

const choices = (
  requests: ReturnType<typeof request>[],
  overrides: Partial<Parameters<typeof getVersionChoices>[0]> = {}
) =>
  getVersionChoices({
    mediaType: 'movie',
    media: media(requests),
    services,
    userId: 7,
    grants: ['radarr:1', 'radarr:2'],
    isManager: false,
    ...overrides,
  });

describe('getVersionChoices', () => {
  it('offers the standard version and the user’s versions', () => {
    const result = choices([]);
    assert.deepStrictEqual(
      result.map((c) => [c.key, c.requestable]),
      [
        ['standard', true],
        ['radarr:1', true],
        ['radarr:2', true],
      ]
    );
  });

  it('closes other versions once the user requested one', () => {
    const result = choices([request(7, 1)]);
    assert.deepStrictEqual(
      result.map((c) => [c.key, c.requestable, c.otherVersionHeld]),
      [
        ['standard', false, true],
        ['radarr:1', false, false],
        ['radarr:2', false, true],
      ]
    );
  });

  it('ignores declined requests and other users’ requests', () => {
    const result = choices([
      request(7, 1, MediaRequestStatus.DECLINED),
      request(8, 2),
    ]);
    assert.ok(result.find((c) => c.key === 'standard')?.requestable);
    assert.ok(result.find((c) => c.key === 'radarr:1')?.requestable);
  });

  it('keeps other versions open when one version per title is off', () => {
    const result = choices([request(7, 1)], { oneVersionPerTitle: false });
    assert.deepStrictEqual(
      result.map((c) => [c.key, c.requestable, c.otherVersionHeld]),
      [
        ['standard', true, false],
        ['radarr:1', false, false],
        ['radarr:2', true, false],
      ]
    );
  });

  it('does not limit request managers', () => {
    const result = choices([request(7, 1)], { isManager: true, grants: [] });
    assert.deepStrictEqual(
      result.map((c) => [c.key, c.otherVersionHeld]),
      [
        ['standard', false],
        ['radarr:1', false],
        ['radarr:2', false],
      ]
    );
  });

  it('offers anime-only versions for anime', () => {
    const result = choices([], { isAnime: true, grants: ['radarr:3'] });
    assert.deepStrictEqual(
      result.map((c) => c.key),
      ['standard', 'radarr:3']
    );
  });
});

describe('initialVersionChoice', () => {
  it('preselects nothing when several versions are open', () => {
    assert.strictEqual(initialVersionChoice(choices([]), null), null);
  });

  it('preselects the remembered version', () => {
    assert.strictEqual(
      initialVersionChoice(choices([]), 'radarr:2'),
      'radarr:2'
    );
  });

  it('skips a remembered version that cannot be requested', () => {
    assert.strictEqual(
      initialVersionChoice(choices([], { grants: ['radarr:1'] }), 'radarr:2'),
      null
    );
  });

  it('preselects the only open version', () => {
    assert.strictEqual(
      initialVersionChoice(choices([], { grants: [] }), null),
      'standard'
    );
  });
});

describe('holdsOtherVersion', () => {
  it('is true only for versions other than the requested one', () => {
    const m = media([request(7, 1)]);
    assert.strictEqual(holdsOtherVersion(m, 7, 'movie', 1), false);
    assert.strictEqual(holdsOtherVersion(m, 7, 'movie', 2), true);
    assert.strictEqual(holdsOtherVersion(m, 7, 'movie'), true);
    assert.strictEqual(holdsOtherVersion(m, 8, 'movie'), false);
  });
});

describe('version request options', () => {
  const option = {
    id: 'english-until-dubbed',
    label: 'English is OK until a dub appears',
    onlyIfNoOtherVersion: true,
  };
  const withOptions = services.map((s) =>
    s.id === 2 ? { ...s, requestOptions: [option] } : s
  ) as ServiceCommonServer[];
  const optionChoice = (
    serviceStatuses: { serviceId: number; status: MediaStatus }[]
  ) =>
    getVersionChoices({
      mediaType: 'movie',
      media: {
        status: MediaStatus.UNKNOWN,
        requests: [],
        serviceStatuses,
      } as unknown as Media,
      services: withOptions,
      userId: 7,
      grants: ['radarr:1', 'radarr:2'],
      isManager: false,
    }).find((c) => c.key === 'radarr:2')!;

  it('lists the version’s options and applies them on a new title', () => {
    const choice = optionChoice([]);
    assert.deepStrictEqual(choice.options, [option]);
    assert.strictEqual(choice.otherVersionHasTitle, false);
    assert.strictEqual(optionApplies(choice, option), true);
  });

  it('skips a conditional option once the standard version has the title', () => {
    const choice = optionChoice([
      { serviceId: 0, status: MediaStatus.AVAILABLE },
    ]);
    assert.strictEqual(choice.otherVersionHasTitle, true);
    assert.strictEqual(optionApplies(choice, option), false);
    assert.strictEqual(
      optionApplies(choice, { ...option, onlyIfNoOtherVersion: false }),
      true
    );
  });

  it('skips a conditional option while another version downloads it', () => {
    const choice = optionChoice([
      { serviceId: 1, status: MediaStatus.PROCESSING },
    ]);
    assert.strictEqual(optionApplies(choice, option), false);
  });

  it('does not give a version’s options to the standard version', () => {
    const standard = getVersionChoices({
      mediaType: 'movie',
      media: media([]),
      services: withOptions,
      userId: 7,
      grants: ['radarr:2'],
      isManager: false,
    })[0];
    assert.deepStrictEqual(standard.options, []);
  });
});

describe('standard request options', () => {
  const dub = {
    id: 'english-dub-only',
    label: 'English dub only',
    onlyIfNoOtherVersion: false,
    animeOnly: true,
  };
  const withStandardOption = services.map((s) =>
    s.id === 0 ? { ...s, requestOptions: [dub] } : s
  ) as ServiceCommonServer[];
  const standardChoice = (isAnime: boolean) =>
    getVersionChoices({
      mediaType: 'movie',
      media: media([]),
      services: withStandardOption,
      isAnime,
      userId: 7,
      grants: [],
      isManager: false,
    })[0];

  it('shows the default server’s options under Standard for anime', () => {
    const choice = standardChoice(true);
    assert.strictEqual(choice.key, 'standard');
    assert.deepStrictEqual(choice.options, [dub]);
    assert.strictEqual(optionApplies(choice, dub), true);
  });

  it('hides anime-only options for other titles', () => {
    assert.deepStrictEqual(standardChoice(false).options, []);
  });
});

describe('version coverage', () => {
  const coverage = [
    { key: 'standard', definingFormats: [], definingMatch: 'all' as const },
    {
      key: 'radarr:1',
      label: 'Russian',
      definingFormats: ['Russian audio'],
      definingMatch: 'all' as const,
      coveredBy: { key: 'standard' },
    },
    {
      key: 'radarr:2',
      label: 'Lithuanian',
      definingFormats: ['Lithuanian audio'],
      definingMatch: 'all' as const,
      requestedVia: {
        key: 'radarr:1',
        label: 'Russian',
        until: '2026-11-03T00:00:00.000Z',
      },
    },
  ];

  it('closes covered and held versions to regular users', () => {
    const result = choices([], { coverage });
    assert.deepStrictEqual(
      result.map((c) => [c.key, c.requestable, c.coveredBy, c.requestedVia]),
      [
        ['standard', true, undefined, undefined],
        ['radarr:1', false, null, undefined],
        ['radarr:2', false, undefined, 'Russian'],
      ]
    );
  });

  it('keeps them open to request managers', () => {
    const result = choices([], { coverage, isManager: true });
    assert.deepStrictEqual(
      result.map((c) => c.requestable),
      [true, true, true]
    );
  });

  it('ignores coverage for shows (seasons decide)', () => {
    const result = choices([], { coverage, mediaType: 'tv' });
    assert.ok(result.every((c) => c.coveredBy === undefined));
  });
});

describe('preferenceChanges', () => {
  const base = {
    mediaType: 'movie' as const,
    selected: 'radarr:2',
    hasOptions: true,
    optionId: null,
  };

  it('saves a new default version and the ticked option', () => {
    assert.deepStrictEqual(
      preferenceChanges({
        ...base,
        saved: {},
        useByDefault: true,
        optionId: 'english-until-dubbed',
      }),
      {
        'default-version-movie': 'radarr:2',
        'option-movie-radarr:2': 'english-until-dubbed',
      }
    );
  });

  it('clears the default when it is unticked for that version', () => {
    assert.deepStrictEqual(
      preferenceChanges({
        ...base,
        hasOptions: false,
        saved: { 'default-version-movie': 'radarr:2' },
        useByDefault: false,
      }),
      { 'default-version-movie': null }
    );
  });

  it('keeps another version as default when this one is not ticked', () => {
    assert.deepStrictEqual(
      preferenceChanges({
        ...base,
        hasOptions: false,
        saved: { 'default-version-movie': 'standard' },
        useByDefault: false,
      }),
      {}
    );
  });

  it('removes an option that was unticked and skips unchanged ones', () => {
    const saved = {
      'default-version-movie': 'radarr:2',
      'option-movie-radarr:2': 'english-until-dubbed',
    };
    assert.deepStrictEqual(
      preferenceChanges({ ...base, saved, useByDefault: true, optionId: null }),
      { 'option-movie-radarr:2': null }
    );
    assert.deepStrictEqual(
      preferenceChanges({
        ...base,
        saved,
        useByDefault: true,
        optionId: 'english-until-dubbed',
      }),
      {}
    );
  });
});

describe('versionRequesters', () => {
  const by = (
    id: number,
    serverId: number | undefined,
    createdAt: string,
    over: Record<string, unknown> = {}
  ) => ({
    requestedBy: { id, displayName: `user${id}` },
    is4k: false,
    isServiceRequest: serverId !== undefined,
    serverId,
    status: MediaRequestStatus.APPROVED,
    createdAt,
    ...over,
  });
  const title = (requests: ReturnType<typeof by>[]) =>
    ({ requests }) as unknown as Media;

  it('lists who requested each version, oldest first, once each', () => {
    const requests = title([
      by(3, 2, '2026-11-03'),
      by(1, undefined, '2026-11-02'),
      by(2, 2, '2026-11-01'),
      by(3, 2, '2026-11-04'),
    ]);
    assert.deepStrictEqual(versionRequesters(requests, 'movie', 'radarr:2'), [
      { id: 2, displayName: 'user2' },
      { id: 3, displayName: 'user3' },
    ]);
    assert.deepStrictEqual(versionRequesters(requests, 'movie', 'standard'), [
      { id: 1, displayName: 'user1' },
    ]);
    assert.deepStrictEqual(
      versionRequesters(requests, 'movie', 'radarr:1'),
      []
    );
  });

  it('skips declined, failed and 4K requests', () => {
    const requests = title([
      by(1, 2, '2026-11-01', { status: MediaRequestStatus.DECLINED }),
      by(2, 2, '2026-11-01', { status: MediaRequestStatus.FAILED }),
      by(3, 2, '2026-11-01', { is4k: true }),
    ]);
    assert.deepStrictEqual(
      versionRequesters(requests, 'movie', 'radarr:2'),
      []
    );
  });

  it('is part of every version choice', () => {
    const [standard, german] = getVersionChoices({
      mediaType: 'movie',
      media: {
        status: MediaStatus.PROCESSING,
        serviceStatuses: [],
        requests: [by(5, undefined, '2026-11-01')],
      } as unknown as Media,
      services,
      userId: 7,
      grants: ['radarr:1'],
      isManager: false,
    });
    assert.deepStrictEqual(standard.requesters, [
      { id: 5, displayName: 'user5' },
    ]);
    assert.deepStrictEqual(german.requesters, []);
  });
});

describe('versionLoading (review M5)', () => {
  const versions = [{ buttonLabel: '' }, { buttonLabel: 'German' }];
  const loaded = { wanted: true, data: {} };
  const failed = { wanted: true, error: new Error('500') };
  const waiting = { wanted: true };

  it('is never loading when versions are off for the dialog', () => {
    assert.strictEqual(
      versionLoading({
        enabled: false,
        services: {},
        coverage: waiting,
        preferences: waiting,
      }),
      false
    );
  });

  it('waits for the servers', () => {
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: {},
        coverage: loaded,
        preferences: loaded,
      }),
      true
    );
  });

  it('opens the dialog when a VSeerr endpoint fails', () => {
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: { error: new Error('500') },
        coverage: failed,
        preferences: failed,
      }),
      false
    );
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: { data: versions },
        coverage: failed,
        preferences: failed,
      }),
      false
    );
  });

  it('waits for coverage when there are versions, so the choice does not flip', () => {
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: { data: versions },
        coverage: waiting,
        preferences: loaded,
      }),
      true
    );
  });

  it('does not wait for coverage without versions', () => {
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: { data: [{ buttonLabel: '' }] },
        coverage: waiting,
        preferences: loaded,
      }),
      false
    );
  });

  it('does not wait for coverage of a title Seerr does not track yet', () => {
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: { data: versions },
        coverage: { wanted: false },
        preferences: loaded,
      }),
      false
    );
  });

  it('waits for the preferences', () => {
    assert.strictEqual(
      versionLoading({
        enabled: true,
        services: { data: versions },
        coverage: loaded,
        preferences: waiting,
      }),
      true
    );
  });
});
