import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { advancedDefaults } from './advancedDefaults';

describe('advancedDefaults', () => {
  it('fixes nothing for a new standard request', () => {
    assert.strictEqual(advancedDefaults({}), undefined);
  });

  it("starts a new version request from its server's defaults (review M6)", () => {
    // null, not undefined: AdvancedRequester only fills in the server's
    // default profile, language and tags for null.
    assert.deepStrictEqual(advancedDefaults({ serverId: 2 }), {
      server: 2,
      profile: null,
      language: null,
      tags: null,
    });
  });

  it('keeps what an edited TV version request was made with (review M4)', () => {
    assert.deepStrictEqual(
      advancedDefaults({
        serverId: 2,
        editRequest: {
          rootFolder: '/tv/kids',
          profileId: 7,
          serverId: 2,
          languageProfileId: 1,
          tags: [3],
        },
      }),
      {
        folder: '/tv/kids',
        profile: 7,
        server: 2,
        language: 1,
        tags: [3],
      }
    );
  });

  it('keeps an edited standard request on its own server', () => {
    assert.strictEqual(
      advancedDefaults({
        editRequest: { serverId: 0, rootFolder: '/movies' },
      })?.server,
      0
    );
  });

  it('leaves values the request was saved without to the server', () => {
    const defaults = advancedDefaults({
      serverId: 1,
      editRequest: {
        serverId: 1,
        rootFolder: null,
        profileId: null,
        languageProfileId: null,
        tags: null,
      },
    });
    assert.strictEqual(defaults?.profile, null);
    assert.strictEqual(defaults?.tags, null);
  });
});
