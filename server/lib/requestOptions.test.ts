import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus } from '@server/constants/media';
import {
  isAnimeTitle,
  MAX_REQUEST_OPTIONS,
  optionsForTitle,
  otherVersionHasTitle,
  publicRequestOptions,
  requestOptionProfile,
  sanitizeRequestOptions,
  standardOptionServer,
} from '@server/lib/requestOptions';

describe('sanitizeRequestOptions', () => {
  it('keeps well-formed options and derives missing ids from the label', () => {
    assert.deepStrictEqual(
      sanitizeRequestOptions([
        {
          label: ' English is OK until dubbed ',
          profileId: 8,
          profileName: 'Lithuanian or English',
          onlyIfNoOtherVersion: true,
        },
      ]),
      [
        {
          id: 'english-is-ok-until-dubbed',
          label: 'English is OK until dubbed',
          profileId: 8,
          profileName: 'Lithuanian or English',
          onlyIfNoOtherVersion: true,
        },
      ]
    );
  });

  it('drops options without a label or a valid profile and non-arrays', () => {
    assert.deepStrictEqual(sanitizeRequestOptions('nope'), []);
    assert.deepStrictEqual(
      sanitizeRequestOptions([
        { label: '', profileId: 1 },
        { label: 'x', profileId: 0 },
        { label: 'y', profileId: 'abc' },
        null,
        42,
      ]),
      []
    );
  });

  it('makes ids unique and keeps a valid given id', () => {
    const options = sanitizeRequestOptions([
      { id: 'kids', label: 'A', profileId: 1 },
      { id: 'kids', label: 'B', profileId: 2 },
      { id: 'Bad Id!', label: 'Kids', profileId: 3 },
    ]);
    assert.deepStrictEqual(
      options.map((o) => o.id),
      ['kids', 'kids-2', 'kids-3']
    );
    assert.strictEqual(options[0].onlyIfNoOtherVersion, false);
  });

  it('limits the number of options', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      label: `Option ${i}`,
      profileId: i + 1,
    }));
    assert.strictEqual(
      sanitizeRequestOptions(many).length,
      MAX_REQUEST_OPTIONS
    );
  });
});

describe('publicRequestOptions', () => {
  it('hides the profile from requesters', () => {
    assert.deepStrictEqual(
      publicRequestOptions([
        {
          id: 'a',
          label: 'A',
          profileId: 8,
          profileName: 'P',
          onlyIfNoOtherVersion: true,
        },
      ]),
      [{ id: 'a', label: 'A', onlyIfNoOtherVersion: true }]
    );
    assert.deepStrictEqual(publicRequestOptions(undefined), []);
  });
});

describe('otherVersionHasTitle', () => {
  const servers = { standardServerIds: [0], versionServerIds: [1, 2] };

  it('sees the title in the standard version', () => {
    assert.strictEqual(
      otherVersionHasTitle({
        ...servers,
        serverId: 2,
        serviceStatuses: [{ serviceId: 0, status: MediaStatus.AVAILABLE }],
      }),
      true
    );
  });

  it('sees the title downloading in another version', () => {
    assert.strictEqual(
      otherVersionHasTitle({
        ...servers,
        serverId: 2,
        serviceStatuses: [{ serviceId: 1, status: MediaStatus.PROCESSING }],
      }),
      true
    );
  });

  it('ignores the version itself and titles that are only requested', () => {
    assert.strictEqual(
      otherVersionHasTitle({
        ...servers,
        serverId: 2,
        serviceStatuses: [
          { serviceId: 2, status: MediaStatus.AVAILABLE },
          { serviceId: 1, status: MediaStatus.PENDING },
          { serviceId: 0, status: MediaStatus.DELETED },
        ],
      }),
      false
    );
  });

  it('uses the standard status when no unlabelled server is configured', () => {
    assert.strictEqual(
      otherVersionHasTitle({
        standardServerIds: [],
        versionServerIds: [1, 2],
        serverId: 2,
        standardStatus: MediaStatus.PARTIALLY_AVAILABLE,
        serviceStatuses: [],
      }),
      true
    );
  });

  it('for the standard version looks at the versions only', () => {
    assert.strictEqual(
      otherVersionHasTitle({
        ...servers,
        serviceStatuses: [
          { serviceId: 0, status: MediaStatus.AVAILABLE },
          { serviceId: 2, status: MediaStatus.AVAILABLE },
        ],
      }),
      true
    );
    assert.strictEqual(
      otherVersionHasTitle({
        ...servers,
        serviceStatuses: [{ serviceId: 0, status: MediaStatus.AVAILABLE }],
      }),
      false
    );
  });
});

describe('requestOptionProfile', () => {
  const option = {
    id: 'a',
    label: 'A',
    profileId: 8,
    onlyIfNoOtherVersion: true,
  };

  it('uses the option profile while no other version has the title', () => {
    assert.strictEqual(requestOptionProfile(option, false), 8);
  });

  it('falls back to the default profile once another version has it', () => {
    assert.strictEqual(requestOptionProfile(option, true), undefined);
  });

  it('always applies an option without the condition', () => {
    assert.strictEqual(
      requestOptionProfile({ ...option, onlyIfNoOtherVersion: false }, true),
      8
    );
  });

  it('is undefined without an option', () => {
    assert.strictEqual(requestOptionProfile(undefined, false), undefined);
  });
});

describe('anime-only options', () => {
  it('keeps the flag through sanitizing and the public view', () => {
    const [option] = sanitizeRequestOptions([
      { label: 'English dub only', profileId: 13, animeOnly: true },
    ]);
    assert.strictEqual(option.animeOnly, true);
    assert.deepStrictEqual(publicRequestOptions([option]), [
      {
        id: 'english-dub-only',
        label: 'English dub only',
        onlyIfNoOtherVersion: false,
        animeOnly: true,
      },
    ]);
  });

  it('leaves anime-only options out for other titles', () => {
    const options = [
      { id: 'a', animeOnly: true },
      { id: 'b', animeOnly: false },
      { id: 'c' },
    ];
    assert.deepStrictEqual(
      optionsForTitle(options, false).map((o) => o.id),
      ['b', 'c']
    );
    assert.strictEqual(optionsForTitle(options, true).length, 3);
  });

  it('reads the anime keyword from movies and shows', () => {
    assert.ok(isAnimeTitle({ keywords: { keywords: [{ id: 210024 }] } }));
    assert.ok(isAnimeTitle({ keywords: { results: [{ id: 210024 }] } }));
    assert.ok(!isAnimeTitle({ keywords: { results: [{ id: 1 }] } }));
    assert.ok(!isAnimeTitle({}));
  });
});

describe('standardOptionServer', () => {
  const servers = [
    { id: 0, is4k: false, isDefault: true },
    { id: 1, is4k: false, isDefault: false, buttonLabel: 'Lithuanian' },
    { id: 2, is4k: true, isDefault: true },
  ];

  it('picks the default server without a version name', () => {
    assert.strictEqual(standardOptionServer(servers, false)?.id, 0);
    assert.strictEqual(standardOptionServer(servers, true)?.id, 2);
  });

  it('never returns a version server', () => {
    assert.strictEqual(standardOptionServer(servers, false, 1), undefined);
    assert.strictEqual(standardOptionServer(servers, false, 0)?.id, 0);
  });
});
