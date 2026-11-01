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

  it('gives the standard version no options', () => {
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
