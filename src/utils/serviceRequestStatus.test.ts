import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type MediaServiceStatus from '@server/entity/MediaServiceStatus';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getServiceStatusItems,
  getSlotSeasonStatus,
  getSlotStatus,
  getStandardServiceId,
  isCoveredByServiceStatus,
  isSlotRequest,
} from './serviceRequestStatus';

const server = (
  id: number,
  overrides: Partial<ServiceCommonServer> = {}
): ServiceCommonServer => ({
  id,
  name: `Radarr ${id}`,
  is4k: false,
  isDefault: false,
  activeProfileId: 1,
  activeDirectory: '/movies',
  activeTags: [],
  ...overrides,
});

const serviceStatus = (
  serviceId: number,
  status: MediaStatus,
  seasonStatuses: Record<number, MediaStatus> | null = null
) =>
  ({
    serviceId,
    serviceType: 'radarr',
    status,
    seasonStatuses,
    downloadStatus: [],
  }) as unknown as MediaServiceStatus;

const pendingRequest = (serverId: number) =>
  ({
    isServiceRequest: true,
    serverId,
    status: MediaRequestStatus.PENDING,
  }) as MediaRequest;

const itemIds = (items: ReturnType<typeof getServiceStatusItems>) =>
  items.map((item) => [item.server.id, item.status]);

describe('getServiceStatusItems', () => {
  it('ignores servers without a button label', () => {
    const items = getServiceStatusItems({
      services: [
        server(0, { isDefault: true }),
        server(1, { is4k: true, isDefault: true }),
      ],
      serviceStatuses: [
        serviceStatus(0, MediaStatus.AVAILABLE),
        serviceStatus(1, MediaStatus.AVAILABLE),
      ],
    });

    assert.deepStrictEqual(items, []);
  });

  it('returns labelled servers with a known status', () => {
    const items = getServiceStatusItems({
      services: [
        server(0, { buttonLabel: 'ITA' }),
        server(1, { buttonLabel: 'ENG' }),
        server(2),
      ],
      serviceStatuses: [
        serviceStatus(0, MediaStatus.AVAILABLE),
        serviceStatus(1, MediaStatus.UNKNOWN),
        serviceStatus(2, MediaStatus.AVAILABLE),
      ],
    });

    assert.deepStrictEqual(itemIds(items), [[0, MediaStatus.AVAILABLE]]);
  });

  it('adds pending service requests for labelled servers', () => {
    const items = getServiceStatusItems({
      services: [server(0, { buttonLabel: 'ITA' }), server(1)],
      requests: [pendingRequest(0), pendingRequest(1)],
    });

    assert.deepStrictEqual(itemIds(items), [[0, MediaStatus.PENDING]]);
  });

  it('uses season statuses when a season is given', () => {
    const items = getServiceStatusItems({
      services: [server(0, { buttonLabel: 'ITA' })],
      serviceStatuses: [
        serviceStatus(0, MediaStatus.PARTIALLY_AVAILABLE, {
          1: MediaStatus.AVAILABLE,
        }),
      ],
      requests: [pendingRequest(0)],
      seasonNumber: 1,
    });

    assert.deepStrictEqual(itemIds(items), [[0, MediaStatus.AVAILABLE]]);
  });

  it('shows a version request for a season the version does not have yet', () => {
    const seasonRequest = (
      serverId: number,
      status: MediaRequestStatus,
      seasons: number[],
      is4k = false
    ) =>
      ({
        isServiceRequest: true,
        serverId,
        status,
        is4k,
        seasons: seasons.map((seasonNumber) => ({ seasonNumber })),
      }) as unknown as MediaRequest;

    const items = getServiceStatusItems({
      services: [
        server(0, { buttonLabel: 'ITA' }),
        server(1, { buttonLabel: 'ENG' }),
        server(2, { buttonLabel: 'GER' }),
      ],
      serviceStatuses: [
        serviceStatus(0, MediaStatus.PARTIALLY_AVAILABLE, {
          1: MediaStatus.AVAILABLE,
        }),
      ],
      requests: [
        seasonRequest(0, MediaRequestStatus.APPROVED, [2]),
        seasonRequest(1, MediaRequestStatus.APPROVED, [2]),
        seasonRequest(2, MediaRequestStatus.PENDING, [2, 3]),
        seasonRequest(2, MediaRequestStatus.COMPLETED, [1]),
        seasonRequest(1, MediaRequestStatus.PENDING, [1], true),
      ],
      seasonNumber: 2,
    });

    assert.deepStrictEqual(itemIds(items), [
      [0, MediaStatus.PROCESSING],
      [1, MediaStatus.PROCESSING],
      [2, MediaStatus.PENDING],
    ]);
    assert.deepStrictEqual(
      itemIds(
        getServiceStatusItems({
          services: [server(1, { buttonLabel: 'ENG' })],
          requests: [seasonRequest(1, MediaRequestStatus.PENDING, [1], true)],
          seasonNumber: 1,
        })
      ),
      []
    );
  });
});

describe('standard status coverage', () => {
  const services = [
    server(0, { isDefault: true, buttonLabel: 'ITA' }),
    server(1, { buttonLabel: 'ENG' }),
    server(2, { is4k: true, isDefault: true }),
  ];

  it('treats the standard status as covered when its server has a service badge', () => {
    const items = getServiceStatusItems({
      services,
      serviceStatuses: [serviceStatus(0, MediaStatus.AVAILABLE)],
    });

    assert.strictEqual(
      isCoveredByServiceStatus(
        items,
        getStandardServiceId(services, {}, false)
      ),
      true
    );
    assert.strictEqual(
      isCoveredByServiceStatus(items, getStandardServiceId(services, {}, true)),
      false
    );
  });

  it('uses the server the media was sent to over the default one', () => {
    const items = getServiceStatusItems({
      services,
      serviceStatuses: [serviceStatus(0, MediaStatus.AVAILABLE)],
    });

    assert.strictEqual(
      isCoveredByServiceStatus(
        items,
        getStandardServiceId(services, { serviceId: 1 }, false)
      ),
      false
    );
  });
});

describe('slots: Standard and versions through one path', () => {
  const standardRequest = { isServiceRequest: false, is4k: false };
  const standard4kRequest = { isServiceRequest: false, is4k: true };
  const versionRequest = { isServiceRequest: true, serverId: 2, is4k: false };

  it('matches a request to Standard, Standard 4K or its version', () => {
    assert.equal(isSlotRequest(standardRequest, undefined), true);
    assert.equal(isSlotRequest(standardRequest, null, true), false);
    assert.equal(isSlotRequest(standard4kRequest, null, true), true);
    assert.equal(isSlotRequest(versionRequest, undefined), false);
    assert.equal(isSlotRequest(versionRequest, 2), true);
    assert.equal(isSlotRequest(versionRequest, 3), false);
    assert.equal(isSlotRequest(standardRequest, 2), false);
  });

  const media = {
    status: MediaStatus.AVAILABLE,
    status4k: MediaStatus.UNKNOWN,
    seasons: [
      { seasonNumber: 1, status: MediaStatus.AVAILABLE },
      { seasonNumber: 2, status: MediaStatus.PROCESSING },
    ],
    serviceStatuses: [
      serviceStatus(0, MediaStatus.PROCESSING, { 1: MediaStatus.PROCESSING }),
      serviceStatus(2, MediaStatus.PARTIALLY_AVAILABLE, {
        1: MediaStatus.AVAILABLE,
      }),
    ],
    requests: [pendingRequest(3)],
  } as unknown as Parameters<typeof getSlotStatus>[0];

  it('reads Standard from Seerr, not from its server row', () => {
    // Seerr also counts the media server: the row of server 0 says
    // processing (an upgrade), but the title is available.
    assert.equal(getSlotStatus(media, undefined), MediaStatus.AVAILABLE);
    assert.equal(getSlotStatus(media, null, true), MediaStatus.UNKNOWN);
  });

  it('reads a version from its row, or from its open request', () => {
    assert.equal(getSlotStatus(media, 2), MediaStatus.PARTIALLY_AVAILABLE);
    assert.equal(getSlotStatus(media, 3), MediaStatus.PENDING);
    assert.equal(getSlotStatus(media, 4), MediaStatus.UNKNOWN);
  });

  it('reads season statuses the same way', () => {
    assert.equal(
      getSlotSeasonStatus(media, undefined, 1),
      MediaStatus.AVAILABLE
    );
    assert.equal(
      getSlotSeasonStatus(media, undefined, 2),
      MediaStatus.PROCESSING
    );
    assert.equal(getSlotSeasonStatus(media, 2, 1), MediaStatus.AVAILABLE);
    assert.equal(getSlotSeasonStatus(media, 2, 2), undefined);
  });
});
