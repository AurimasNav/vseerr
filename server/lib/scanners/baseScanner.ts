import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import MediaServiceStatus from '@server/entity/MediaServiceStatus';
import Season from '@server/entity/Season';
import { upsertMediaServiceStatus } from '@server/lib/mediaServiceStatus';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { versionServerIds } from '@server/lib/versions';
import logger from '@server/logger';
import AsyncLock from '@server/utils/asyncLock';
import { randomUUID } from 'crypto';
import { In } from 'typeorm';

// Default scan rates (can be overidden)
const BUNDLE_SIZE = 20;
const UPDATE_RATE = 4 * 1000;

export type StatusBase = {
  running: boolean;
  progress: number;
  total: number;
};

export interface RunnableScanner<T> {
  run: () => Promise<void>;
  status: () => T & StatusBase;
}

export interface MediaIds {
  tmdbId: number;
  imdbId?: string;
  tvdbId?: number;
  isHama?: boolean;
}

interface ProcessOptions {
  is4k?: boolean;
  mediaAddedAt?: Date;
  ratingKey?: string;
  jellyfinMediaId?: string;
  imdbId?: string;
  serviceId?: number;
  externalServiceId?: number;
  externalServiceSlug?: string;
  title?: string;
  processing?: boolean;
  hasFile?: boolean;
}

export interface ProcessableSeason {
  seasonNumber: number;
  totalEpisodes: number;
  episodes: number;
  episodes4k: number;
  is4kOverride?: boolean;
  processing?: boolean;
}

class BaseScanner<T> {
  private bundleSize;
  private updateRate;
  protected progress = 0;
  protected items: T[] = [];
  protected totalSize?: number = 0;
  protected scannerName: string;
  protected enable4kMovie = false;
  protected enable4kShow = false;
  protected sessionId: string;
  protected running = false;
  // Only the *arr scanners know whether a title is still being pursued.
  protected declineRequestsOnStatusReset = false;
  private statusResetCandidates = new Map<
    string,
    { mediaId: number; is4k: boolean }
  >();
  readonly asyncLock = new AsyncLock();
  readonly tmdb = new TheMovieDb();

  protected constructor(
    scannerName: string,
    {
      updateRate,
      bundleSize,
    }: {
      updateRate?: number;
      bundleSize?: number;
    } = {}
  ) {
    this.scannerName = scannerName;
    this.bundleSize = bundleSize ?? BUNDLE_SIZE;
    this.updateRate = updateRate ?? UPDATE_RATE;
  }

  private async getExisting(tmdbId: number, mediaType: MediaType) {
    const mediaRepository = getRepository(Media);

    const existing = await mediaRepository.findOne({
      where: { tmdbId: tmdbId, mediaType },
    });

    return existing;
  }

  protected async processMovie(
    tmdbId: number,
    {
      is4k = false,
      mediaAddedAt,
      ratingKey,
      jellyfinMediaId,
      imdbId,
      serviceId,
      externalServiceId,
      externalServiceSlug,
      processing = false,
      title = 'Unknown Title',
      hasFile = true,
    }: ProcessOptions = {}
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    await this.asyncLock.dispatch(tmdbId, async () => {
      const existing = await this.getExisting(tmdbId, MediaType.MOVIE);
      let mediaId: number;

      if (existing) {
        let changedExisting = false;
        const statusField = is4k ? 'status4k' : 'status';
        const previousStatus = existing[statusField];
        const abandonedEntry = !processing && !hasFile;
        // VSeerr: a media server file of a movie only versions have is theirs.
        const versionOnly =
          serviceId === undefined &&
          !is4k &&
          (await this.versionOnlyParts(existing.id, MediaType.MOVIE)).title;
        // One server cannot speak for the others; settled after the whole run.
        const deferredReset =
          this.declineRequestsOnStatusReset &&
          abandonedEntry &&
          previousStatus === MediaStatus.PROCESSING;

        if (deferredReset) {
          this.recordStatusReset(existing.id, is4k);
        }

        if (
          previousStatus !== MediaStatus.AVAILABLE &&
          !deferredReset &&
          !versionOnly
        ) {
          existing[statusField] =
            !processing && hasFile
              ? MediaStatus.AVAILABLE
              : abandonedEntry && previousStatus === MediaStatus.PROCESSING
                ? MediaStatus.UNKNOWN
                : processing
                  ? previousStatus === MediaStatus.DELETED
                    ? MediaStatus.DELETED
                    : MediaStatus.PROCESSING
                  : previousStatus;

          if (existing[statusField] !== previousStatus) {
            if (mediaAddedAt) {
              existing.mediaAddedAt = mediaAddedAt;
            }
            changedExisting = true;
          }
        }

        if (!changedExisting && !existing.mediaAddedAt && mediaAddedAt) {
          existing.mediaAddedAt = mediaAddedAt;
          changedExisting = true;
        }

        if (
          ratingKey &&
          existing[is4k ? 'ratingKey4k' : 'ratingKey'] !== ratingKey
        ) {
          existing[is4k ? 'ratingKey4k' : 'ratingKey'] = ratingKey;
          changedExisting = true;
        }

        if (
          jellyfinMediaId &&
          existing[is4k ? 'jellyfinMediaId4k' : 'jellyfinMediaId'] !==
            jellyfinMediaId
        ) {
          existing[is4k ? 'jellyfinMediaId4k' : 'jellyfinMediaId'] =
            jellyfinMediaId;
          changedExisting = true;
        }

        if (imdbId && !existing.imdbId) {
          existing.imdbId = imdbId;
          changedExisting = true;
        }

        // Letting an abandoned entry claim these would make them scan-order dependent.
        if (!deferredReset) {
          if (
            serviceId !== undefined &&
            existing[is4k ? 'serviceId4k' : 'serviceId'] !== serviceId
          ) {
            existing[is4k ? 'serviceId4k' : 'serviceId'] = serviceId;
            changedExisting = true;
          }

          if (
            externalServiceId !== undefined &&
            existing[is4k ? 'externalServiceId4k' : 'externalServiceId'] !==
              externalServiceId
          ) {
            existing[is4k ? 'externalServiceId4k' : 'externalServiceId'] =
              externalServiceId;
            changedExisting = true;
          }

          if (
            externalServiceSlug !== undefined &&
            existing[is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'] !==
              externalServiceSlug
          ) {
            existing[is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'] =
              externalServiceSlug;
            changedExisting = true;
          }
        }

        if (changedExisting) {
          await mediaRepository.save(existing);
          this.log(
            `Media for ${title} exists. Changes were detected and the title will be updated.`,
            'info'
          );
        } else {
          this.log(`Title already exists and no changes detected for ${title}`);
        }

        mediaId = existing.id;
      } else {
        if (!processing && !hasFile) {
          return;
        }

        const newMedia = new Media();
        newMedia.tmdbId = tmdbId;
        newMedia.imdbId = imdbId;

        newMedia.status =
          !is4k && !processing
            ? MediaStatus.AVAILABLE
            : !is4k && processing
              ? MediaStatus.PROCESSING
              : MediaStatus.UNKNOWN;
        newMedia.status4k =
          is4k && this.enable4kMovie && !processing
            ? MediaStatus.AVAILABLE
            : is4k && this.enable4kMovie && processing
              ? MediaStatus.PROCESSING
              : MediaStatus.UNKNOWN;
        newMedia.mediaType = MediaType.MOVIE;
        newMedia.serviceId = !is4k ? serviceId : undefined;
        newMedia.serviceId4k = is4k ? serviceId : undefined;
        newMedia.externalServiceId = !is4k ? externalServiceId : undefined;
        newMedia.externalServiceId4k = is4k ? externalServiceId : undefined;
        newMedia.externalServiceSlug = !is4k ? externalServiceSlug : undefined;
        newMedia.externalServiceSlug4k = is4k ? externalServiceSlug : undefined;

        if (mediaAddedAt) {
          newMedia.mediaAddedAt = mediaAddedAt;
        }

        if (ratingKey) {
          newMedia.ratingKey = !is4k ? ratingKey : undefined;
          newMedia.ratingKey4k =
            is4k && this.enable4kMovie ? ratingKey : undefined;
        }

        if (jellyfinMediaId) {
          newMedia.jellyfinMediaId = !is4k ? jellyfinMediaId : undefined;
          newMedia.jellyfinMediaId4k =
            is4k && this.enable4kMovie ? jellyfinMediaId : undefined;
        }

        await mediaRepository.save(newMedia);
        this.log(`Saved new media: ${title}`);

        mediaId = newMedia.id;
      }

      if (serviceId !== undefined) {
        await this.upsertServiceStatus(
          mediaId,
          serviceId,
          'radarr',
          !processing && hasFile
            ? MediaStatus.AVAILABLE
            : processing
              ? MediaStatus.PROCESSING
              : MediaStatus.UNKNOWN,
          externalServiceId,
          externalServiceSlug
        );
      }
    });
  }

  /**
   * processShow takes a TMDB ID and an array of ProcessableSeasons, which
   * should include the total episodes a sesaon has + the total available
   * episodes that each season currently has. Unlike processMovie, this method
   * does not take an `is4k` option. We handle both the 4k _and_ non 4k status
   * in one method.
   *
   * Note: If 4k is not enable, ProcessableSeasons should combine their episode counts
   * into the normal episodes properties and avoid using the 4k properties.
   */
  protected async processShow(
    tmdbId: number,
    tvdbId: number | undefined,
    seasons: ProcessableSeason[],
    {
      mediaAddedAt,
      ratingKey,
      jellyfinMediaId,
      serviceId,
      externalServiceId,
      externalServiceSlug,
      is4k = false,
      title = 'Unknown Title',
    }: ProcessOptions = {}
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    await this.asyncLock.dispatch(tmdbId, async () => {
      const media = await this.getExisting(tmdbId, MediaType.TV);
      // VSeerr: a media server's episodes of seasons only versions have are theirs.
      const versionOnlySeasons =
        media && serviceId === undefined
          ? (await this.versionOnlyParts(media.id, MediaType.TV)).seasons
          : new Set<number>();

      const newSeasons: Season[] = [];

      const currentStandardSeasonsAvailable = (
        media?.seasons.filter(
          (season) => season.status === MediaStatus.AVAILABLE
        ) ?? []
      ).length;

      const current4kSeasonsAvailable = (
        media?.seasons.filter(
          (season) => season.status4k === MediaStatus.AVAILABLE
        ) ?? []
      ).length;

      for (const rawSeason of seasons) {
        // Files can't promote a season the provider reports as empty.
        // Zeroing the counts leaves any existing status for availabilitySync to judge.
        const season =
          rawSeason.totalEpisodes > 0
            ? versionOnlySeasons.has(rawSeason.seasonNumber)
              ? { ...rawSeason, episodes: 0 }
              : rawSeason
            : { ...rawSeason, episodes: 0, episodes4k: 0 };
        // The library still links to the show when only a version has it.
        const inLibrary =
          season.episodes > 0 ||
          (versionOnlySeasons.has(rawSeason.seasonNumber) &&
            rawSeason.episodes > 0);

        const existingSeason = media?.seasons.find(
          (es) => es.seasonNumber === season.seasonNumber
        );

        // We update the rating keys and jellyfinMediaId in the seasons loop because we need episode counts
        if (media && inLibrary && media.ratingKey !== ratingKey) {
          media.ratingKey = ratingKey;
        }

        if (
          media &&
          season.episodes4k > 0 &&
          this.enable4kShow &&
          media.ratingKey4k !== ratingKey
        ) {
          media.ratingKey4k = ratingKey;
        }

        if (media && inLibrary && media.jellyfinMediaId !== jellyfinMediaId) {
          media.jellyfinMediaId = jellyfinMediaId;
        }

        if (
          media &&
          season.episodes4k > 0 &&
          this.enable4kShow &&
          media.jellyfinMediaId4k !== jellyfinMediaId
        ) {
          media.jellyfinMediaId4k = jellyfinMediaId;
        }

        if (existingSeason) {
          // Here we update seasons if they already exist.
          // If the season is already marked as available, we
          // force it to stay available (to avoid competing scanners)
          existingSeason.status =
            (season.totalEpisodes === season.episodes && season.episodes > 0) ||
            existingSeason.status === MediaStatus.AVAILABLE
              ? MediaStatus.AVAILABLE
              : season.episodes > 0
                ? MediaStatus.PARTIALLY_AVAILABLE
                : !season.is4kOverride &&
                    season.processing &&
                    existingSeason.status !== MediaStatus.DELETED
                  ? MediaStatus.PROCESSING
                  : !season.is4kOverride &&
                      !season.processing &&
                      season.episodes === 0 &&
                      existingSeason.status === MediaStatus.PROCESSING
                    ? MediaStatus.UNKNOWN
                    : existingSeason.status;

          // Same thing here, except we only do updates if 4k is enabled
          existingSeason.status4k =
            (this.enable4kShow &&
              season.episodes4k === season.totalEpisodes &&
              season.episodes4k > 0) ||
            existingSeason.status4k === MediaStatus.AVAILABLE
              ? MediaStatus.AVAILABLE
              : this.enable4kShow && season.episodes4k > 0
                ? MediaStatus.PARTIALLY_AVAILABLE
                : season.is4kOverride &&
                    season.processing &&
                    existingSeason.status4k !== MediaStatus.DELETED
                  ? MediaStatus.PROCESSING
                  : season.is4kOverride &&
                      !season.processing &&
                      season.episodes4k === 0 &&
                      existingSeason.status4k === MediaStatus.PROCESSING
                    ? MediaStatus.UNKNOWN
                    : existingSeason.status4k;
        } else {
          newSeasons.push(
            new Season({
              seasonNumber: season.seasonNumber,
              status:
                season.totalEpisodes === season.episodes && season.episodes > 0
                  ? MediaStatus.AVAILABLE
                  : season.episodes > 0
                    ? MediaStatus.PARTIALLY_AVAILABLE
                    : !season.is4kOverride && season.processing
                      ? MediaStatus.PROCESSING
                      : MediaStatus.UNKNOWN,
              status4k:
                this.enable4kShow &&
                season.totalEpisodes === season.episodes4k &&
                season.episodes4k > 0
                  ? MediaStatus.AVAILABLE
                  : this.enable4kShow && season.episodes4k > 0
                    ? MediaStatus.PARTIALLY_AVAILABLE
                    : season.is4kOverride && season.processing
                      ? MediaStatus.PROCESSING
                      : MediaStatus.UNKNOWN,
            })
          );
        }
      }

      if (media) {
        media.seasons = [...media.seasons, ...newSeasons];

        const newStandardSeasonsAvailable = (
          media.seasons.filter(
            (season) => season.status === MediaStatus.AVAILABLE
          ) ?? []
        ).length;

        const new4kSeasonsAvailable = (
          media.seasons.filter(
            (season) => season.status4k === MediaStatus.AVAILABLE
          ) ?? []
        ).length;

        // If at least one new season has become available, update
        // the lastSeasonChange field so we can trigger notifications
        if (newStandardSeasonsAvailable > currentStandardSeasonsAvailable) {
          this.log(
            `Detected ${
              newStandardSeasonsAvailable - currentStandardSeasonsAvailable
            } new standard season(s) for ${title}`,
            'debug'
          );
          media.lastSeasonChange = new Date();

          if (mediaAddedAt) {
            media.mediaAddedAt = mediaAddedAt;
          }
        }

        if (new4kSeasonsAvailable > current4kSeasonsAvailable) {
          this.log(
            `Detected ${
              new4kSeasonsAvailable - current4kSeasonsAvailable
            } new 4K season(s) for ${title}`,
            'debug'
          );
          media.lastSeasonChange = new Date();
        }

        if (!media.mediaAddedAt && mediaAddedAt) {
          media.mediaAddedAt = mediaAddedAt;
        }

        if (serviceId !== undefined) {
          media[is4k ? 'serviceId4k' : 'serviceId'] = serviceId;
        }

        if (externalServiceId !== undefined) {
          media[is4k ? 'externalServiceId4k' : 'externalServiceId'] =
            externalServiceId;
        }

        if (externalServiceSlug !== undefined) {
          media[is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'] =
            externalServiceSlug;
        }

        const nonSpecialSeasons = media.seasons.filter(
          (s) => s.seasonNumber !== 0
        );

        // DB-only seasons block the rollup unless UNKNOWN (orphan placeholders
        // can never be revisited by a scan and would pin the show forever).
        const countsTowardsRollup = (
          s: Season,
          statusKey: 'status' | 'status4k'
        ): boolean => {
          const scannedSeason = seasons.find(
            (season) => season.seasonNumber === s.seasonNumber
          );

          if (scannedSeason) {
            return scannedSeason.totalEpisodes > 0;
          }

          return s[statusKey] !== MediaStatus.UNKNOWN;
        };

        const standardSeasonsForRollup = nonSpecialSeasons.filter((s) =>
          countsTowardsRollup(s, 'status')
        );
        const isAllStandardSeasonsAvailable =
          standardSeasonsForRollup.length > 0 &&
          standardSeasonsForRollup.every(
            (s) => s.status === MediaStatus.AVAILABLE
          );

        const seasons4kForRollup = nonSpecialSeasons.filter((s) =>
          countsTowardsRollup(s, 'status4k')
        );
        const isAll4kSeasonsAvailable =
          seasons4kForRollup.length > 0 &&
          seasons4kForRollup.every((s) => s.status4k === MediaStatus.AVAILABLE);

        const previousStatus = media.status;
        const previousStatus4k = media.status4k;

        media.status = isAllStandardSeasonsAvailable
          ? MediaStatus.AVAILABLE
          : media.seasons.some(
                (season) =>
                  season.status === MediaStatus.PARTIALLY_AVAILABLE ||
                  season.status === MediaStatus.AVAILABLE
              )
            ? MediaStatus.PARTIALLY_AVAILABLE
            : (!seasons.length && media.status !== MediaStatus.DELETED) ||
                media.seasons.some(
                  (season) => season.status === MediaStatus.PROCESSING
                )
              ? MediaStatus.PROCESSING
              : media.status === MediaStatus.DELETED
                ? MediaStatus.DELETED
                : MediaStatus.UNKNOWN;
        media.status4k =
          isAll4kSeasonsAvailable && this.enable4kShow
            ? MediaStatus.AVAILABLE
            : this.enable4kShow &&
                media.seasons.some(
                  (season) =>
                    season.status4k === MediaStatus.PARTIALLY_AVAILABLE ||
                    season.status4k === MediaStatus.AVAILABLE
                )
              ? MediaStatus.PARTIALLY_AVAILABLE
              : (!seasons.length && media.status4k !== MediaStatus.DELETED) ||
                  media.seasons.some(
                    (season) => season.status4k === MediaStatus.PROCESSING
                  )
                ? MediaStatus.PROCESSING
                : media.status4k === MediaStatus.DELETED
                  ? MediaStatus.DELETED
                  : MediaStatus.UNKNOWN;
        await mediaRepository.save(media);
        this.log(`Updating existing title: ${title}`);

        if (serviceId !== undefined) {
          const { overall, perSeason } = this.computeSeasonServiceStatuses(
            seasons,
            is4k
          );
          await this.upsertServiceStatus(
            media.id,
            serviceId,
            'sonarr',
            overall,
            externalServiceId,
            externalServiceSlug,
            perSeason
          );
        }

        if (
          previousStatus === MediaStatus.PROCESSING &&
          media.status === MediaStatus.UNKNOWN
        ) {
          this.recordStatusReset(media.id, false);
        }

        if (
          previousStatus4k === MediaStatus.PROCESSING &&
          media.status4k === MediaStatus.UNKNOWN
        ) {
          this.recordStatusReset(media.id, true);
        }
      } else {
        // For new media, check actual newSeasons objects instead of scanner
        // input to determine overall availability status
        const nonSpecialNewSeasons = newSeasons.filter(
          (s) => s.seasonNumber !== 0
        );

        const newSeasonsForRollup = nonSpecialNewSeasons.filter(
          (s) =>
            (seasons.find((season) => season.seasonNumber === s.seasonNumber)
              ?.totalEpisodes ?? 0) > 0
        );
        const isAllStandardSeasonsAvailable =
          newSeasonsForRollup.length > 0 &&
          newSeasonsForRollup.every((s) => s.status === MediaStatus.AVAILABLE);

        const isAll4kSeasonsAvailable =
          newSeasonsForRollup.length > 0 &&
          newSeasonsForRollup.every(
            (s) => s.status4k === MediaStatus.AVAILABLE
          );

        const newMedia = new Media({
          mediaType: MediaType.TV,
          seasons: newSeasons,
          tmdbId,
          tvdbId,
          mediaAddedAt,
          serviceId: !is4k ? serviceId : undefined,
          serviceId4k: is4k ? serviceId : undefined,
          externalServiceId: !is4k ? externalServiceId : undefined,
          externalServiceId4k: is4k ? externalServiceId : undefined,
          externalServiceSlug: !is4k ? externalServiceSlug : undefined,
          externalServiceSlug4k: is4k ? externalServiceSlug : undefined,
          ratingKey: newSeasons.some(
            (sn) =>
              sn.status === MediaStatus.PARTIALLY_AVAILABLE ||
              sn.status === MediaStatus.AVAILABLE
          )
            ? ratingKey
            : undefined,
          ratingKey4k:
            this.enable4kShow &&
            newSeasons.some(
              (sn) =>
                sn.status4k === MediaStatus.PARTIALLY_AVAILABLE ||
                sn.status4k === MediaStatus.AVAILABLE
            )
              ? ratingKey
              : undefined,
          jellyfinMediaId: newSeasons.some(
            (sn) =>
              sn.status === MediaStatus.PARTIALLY_AVAILABLE ||
              sn.status === MediaStatus.AVAILABLE
          )
            ? jellyfinMediaId
            : undefined,
          jellyfinMediaId4k:
            this.enable4kShow &&
            newSeasons.some(
              (sn) =>
                sn.status4k === MediaStatus.PARTIALLY_AVAILABLE ||
                sn.status4k === MediaStatus.AVAILABLE
            )
              ? jellyfinMediaId
              : undefined,
          status: isAllStandardSeasonsAvailable
            ? MediaStatus.AVAILABLE
            : newSeasons.some(
                  (season) =>
                    season.status === MediaStatus.PARTIALLY_AVAILABLE ||
                    season.status === MediaStatus.AVAILABLE
                )
              ? MediaStatus.PARTIALLY_AVAILABLE
              : newSeasons.some(
                    (season) => season.status === MediaStatus.PROCESSING
                  )
                ? MediaStatus.PROCESSING
                : MediaStatus.UNKNOWN,
          status4k:
            isAll4kSeasonsAvailable && this.enable4kShow
              ? MediaStatus.AVAILABLE
              : this.enable4kShow &&
                  newSeasons.some(
                    (season) =>
                      season.status4k === MediaStatus.PARTIALLY_AVAILABLE ||
                      season.status4k === MediaStatus.AVAILABLE
                  )
                ? MediaStatus.PARTIALLY_AVAILABLE
                : newSeasons.some(
                      (season) => season.status4k === MediaStatus.PROCESSING
                    )
                  ? MediaStatus.PROCESSING
                  : MediaStatus.UNKNOWN,
        });
        await mediaRepository.save(newMedia);
        this.log(`Saved ${title}`);

        if (serviceId !== undefined && newMedia.id) {
          const { overall, perSeason } = this.computeSeasonServiceStatuses(
            seasons,
            is4k
          );
          await this.upsertServiceStatus(
            newMedia.id,
            serviceId,
            'sonarr',
            overall,
            externalServiceId,
            externalServiceSlug,
            perSeason
          );
        }
      }
    });
  }

  /**
   * Declines APPROVED requests bound to media that has been orphaned before completion.
   * DECLINED clears the duplicate-request guard so the user can re-request it.
   * Callers must load the requests relation on the media.
   */
  protected async declineOrphanedRequests(
    media: Media,
    is4k: boolean,
    reason = 'not found in any Sonarr/Radarr server'
  ): Promise<void> {
    if (media.requests === undefined) {
      throw new Error(
        `declineOrphanedRequests called for media ${media.id} without the 'requests' relation loaded`
      );
    }

    const requestRepository = getRepository(MediaRequest);

    // Version requests follow their own server (see resetStaleServiceStatus).
    const orphanedRequests = (media.requests ?? []).filter(
      (request) =>
        request.is4k === is4k &&
        !request.isServiceRequest &&
        request.status === MediaRequestStatus.APPROVED
    );

    for (const request of orphanedRequests) {
      request.status = MediaRequestStatus.DECLINED;
      // Ensure that the media relation is set so the AfterUpdate
      // notification hook can resolve it
      request.media = media;
      await requestRepository.save(request);
      this.log(
        `Declined orphaned ${
          media.mediaType === MediaType.MOVIE ? 'movie' : 'series'
        } request ${request.id} for ${media.tmdbId} ${reason}.`,
        'info'
      );
    }
  }

  private recordStatusReset(mediaId: number, is4k: boolean): void {
    if (!this.declineRequestsOnStatusReset) {
      return;
    }

    this.statusResetCandidates.set(`${mediaId}:${is4k}`, { mediaId, is4k });
  }

  // Runs once the caller can answer for every server, not just the current one.
  protected async resolveStatusResets(
    isAbandoned: (media: Media, is4k: boolean) => boolean
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    for (const { mediaId, is4k } of this.statusResetCandidates.values()) {
      const media = await mediaRepository.findOne({
        where: { id: mediaId },
        relations: { requests: true },
      });

      if (!media || !isAbandoned(media, is4k)) {
        continue;
      }

      const statusField = is4k ? 'status4k' : 'status';

      if (media[statusField] === MediaStatus.PROCESSING) {
        media[statusField] = MediaStatus.UNKNOWN;
        await mediaRepository.save(media);
      } else if (media[statusField] !== MediaStatus.UNKNOWN) {
        // Something finished or deleted it mid-run; it is no longer ours to reset.
        continue;
      }

      await this.declineOrphanedRequests(
        media,
        is4k,
        'reset to UNKNOWN after the Sonarr/Radarr entry went unmonitored with nothing downloaded'
      );
    }
  }

  /**
   * Call startRun from child class whenever a run is starting to
   * ensure required values are set
   *
   * Returns the session ID which is requried for the cleanup method
   */
  protected startRun(): string {
    const settings = getSettings();
    const sessionId = randomUUID();
    this.sessionId = sessionId;
    this.statusResetCandidates.clear();

    this.log('Scan starting', 'info', { sessionId });

    this.enable4kMovie = settings.radarr.some((radarr) => radarr.is4k);
    if (this.enable4kMovie) {
      this.log(
        'At least one 4K Radarr server was detected. 4K movie detection is now enabled',
        'info'
      );
    }

    this.enable4kShow = settings.sonarr.some((sonarr) => sonarr.is4k);
    if (this.enable4kShow) {
      this.log(
        'At least one 4K Sonarr server was detected. 4K series detection is now enabled',
        'info'
      );
    }

    this.running = true;

    return sessionId;
  }

  /**
   * Call at end of run loop to perform cleanup
   */
  protected endRun(sessionId: string): void {
    if (this.sessionId === sessionId) {
      this.running = false;
    }
  }

  public cancel(): void {
    this.running = false;
  }

  protected async loop(
    processFn: (item: T) => Promise<void>,
    {
      start = 0,
      end = this.bundleSize,
      sessionId,
    }: {
      start?: number;
      end?: number;
      sessionId?: string;
    } = {}
  ): Promise<void> {
    const slicedItems = this.items.slice(start, end);

    if (!this.running) {
      throw new Error('Sync was aborted.');
    }

    if (this.sessionId !== sessionId) {
      throw new Error('New session was started. Old session aborted.');
    }

    if (start < this.items.length) {
      this.progress = start;
      await this.processItems(processFn, slicedItems);

      await new Promise<void>((resolve, reject) =>
        setTimeout(() => {
          this.loop(processFn, {
            start: start + this.bundleSize,
            end: end + this.bundleSize,
            sessionId,
          })
            .then(() => resolve())
            .catch((e) => reject(new Error(e.message)));
        }, this.updateRate)
      );
    }
  }

  private async processItems(
    processFn: (items: T) => Promise<void>,
    items: T[]
  ) {
    await Promise.all(
      items.map(async (item) => {
        await processFn(item);
      })
    );
  }

  protected log(
    message: string,
    level: 'info' | 'error' | 'debug' | 'warn' = 'debug',
    optional?: Record<string, unknown>
  ): void {
    logger[level](message, { label: this.scannerName, ...optional });
  }

  protected computeSeasonServiceStatuses(
    seasons: ProcessableSeason[],
    is4k: boolean
  ): { overall: MediaStatus; perSeason: Record<number, MediaStatus> } {
    const episodeField = is4k ? 'episodes4k' : 'episodes';
    const perSeason: Record<number, MediaStatus> = {};

    const statusForSeason = (s: ProcessableSeason): MediaStatus => {
      if (s.totalEpisodes > 0 && s[episodeField] === s.totalEpisodes) {
        return MediaStatus.AVAILABLE;
      }
      if (s[episodeField] > 0) {
        return MediaStatus.PARTIALLY_AVAILABLE;
      }
      if (s.processing) {
        return MediaStatus.PROCESSING;
      }
      return MediaStatus.UNKNOWN;
    };

    for (const s of seasons) {
      const status = statusForSeason(s);
      if (status !== MediaStatus.UNKNOWN) {
        perSeason[s.seasonNumber] = status;
      }
    }

    const relevant = seasons.filter(
      (s) => s.seasonNumber !== 0 && s.totalEpisodes > 0
    );

    let overall: MediaStatus;
    if (relevant.length === 0) {
      overall = MediaStatus.UNKNOWN;
    } else if (
      relevant.every(
        (s) => s[episodeField] === s.totalEpisodes && s[episodeField] > 0
      )
    ) {
      overall = MediaStatus.AVAILABLE;
    } else if (relevant.some((s) => s[episodeField] > 0)) {
      overall = MediaStatus.PARTIALLY_AVAILABLE;
    } else if (relevant.some((s) => s.processing)) {
      overall = MediaStatus.PROCESSING;
    } else {
      overall = MediaStatus.UNKNOWN;
    }

    return { overall, perSeason };
  }

  // Overridden by the *arr scanners, the only ones writing service statuses.
  protected getConfiguredServers(): DVRSettings[] {
    return [];
  }

  /**
   * Settings can list one *arr instance more than once, but only the first
   * entry is scanned. Its statuses also apply to the synced duplicates.
   */
  protected getServiceIds(serviceId: number): number[] {
    const servers = this.getConfiguredServers();
    const scanned = servers.find((server) => server.id === serviceId);

    if (!scanned) {
      return [serviceId];
    }

    return servers
      .filter(
        (server) =>
          server.id === serviceId ||
          (server.syncEnabled &&
            server.hostname === scanned.hostname &&
            server.port === scanned.port &&
            server.baseUrl === scanned.baseUrl)
      )
      .map((server) => server.id);
  }

  protected async upsertServiceStatus(
    mediaId: number,
    scannedServiceId: number,
    serviceType: 'radarr' | 'sonarr',
    status: MediaStatus,
    externalServiceId: number | undefined,
    externalServiceSlug: string | undefined,
    seasonStatuses: Record<number, MediaStatus> | null = null
  ): Promise<void> {
    const repo = getRepository(MediaServiceStatus);

    for (const serviceId of this.getServiceIds(scannedServiceId)) {
      await upsertMediaServiceStatus(
        repo,
        {
          mediaId,
          serviceId,
          serviceType,
          status,
          externalServiceId: externalServiceId ?? null,
          externalServiceSlug: externalServiceSlug ?? null,
          seasonStatuses,
        },
        ['status', 'externalServiceId', 'externalServiceSlug', 'seasonStatuses']
      );

      if (
        status === MediaStatus.AVAILABLE ||
        Object.values(seasonStatuses ?? {}).some(
          (seasonStatus) => seasonStatus === MediaStatus.AVAILABLE
        )
      ) {
        await this.completeAvailableServiceRequests(
          mediaId,
          serviceId,
          status,
          seasonStatuses
        );
      }
    }
  }

  private async completeAvailableServiceRequests(
    mediaId: number,
    serviceId: number,
    status: MediaStatus,
    seasonStatuses: Record<number, MediaStatus> | null
  ): Promise<void> {
    const requestRepository = getRepository(MediaRequest);
    const approvedRequests = await requestRepository.find({
      where: {
        media: { id: mediaId },
        serverId: serviceId,
        isServiceRequest: true,
        status: MediaRequestStatus.APPROVED,
      },
    });

    for (const request of approvedRequests) {
      const isComplete =
        request.type === MediaType.MOVIE
          ? status === MediaStatus.AVAILABLE
          : request.seasons.length > 0 &&
            request.seasons.every(
              (season) =>
                seasonStatuses?.[season.seasonNumber] === MediaStatus.AVAILABLE
            );

      if (isComplete) {
        request.status = MediaRequestStatus.COMPLETED;
        request.seasons.forEach((season) => {
          season.status = MediaRequestStatus.COMPLETED;
        });
        await requestRepository.save(request);
        this.log(
          `Service request ${request.id} marked as completed (service ${serviceId})`,
          'info'
        );
      }
    }
  }

  protected async resetStaleServiceStatus({
    serviceId,
    serviceType,
    mediaType,
    seenTmdbIds,
    serverName,
    clearSeasonStatuses = false,
  }: {
    serviceId: number;
    serviceType: 'radarr' | 'sonarr';
    mediaType: MediaType;
    seenTmdbIds: Set<number>;
    serverName: string;
    clearSeasonStatuses?: boolean;
  }): Promise<void> {
    if (seenTmdbIds.size === 0) {
      this.log(
        `No titles were processed for ${serverName}. Stale service status reset will be skipped.`,
        'warn'
      );
      return;
    }

    const serviceStatusRepository = getRepository(MediaServiceStatus);

    const candidates: { id: number; mediaId: number; tmdbId: number }[] =
      await serviceStatusRepository
        .createQueryBuilder('serviceStatus')
        .innerJoin(Media, 'media', 'media.id = serviceStatus.mediaId')
        .select('serviceStatus.id', 'id')
        .addSelect('serviceStatus.mediaId', 'mediaId')
        .addSelect('media.tmdbId', 'tmdbId')
        .where('serviceStatus.serviceId = :serviceId', { serviceId })
        .andWhere('serviceStatus.serviceType = :serviceType', { serviceType })
        .andWhere('serviceStatus.status NOT IN (:...exempt)', {
          exempt: [MediaStatus.UNKNOWN, MediaStatus.DELETED],
        })
        .andWhere('media.mediaType = :mediaType', { mediaType })
        .getRawMany();

    const staleCandidates = candidates.filter(
      (candidate) => !seenTmdbIds.has(Number(candidate.tmdbId))
    );
    const staleIds = staleCandidates.map((candidate) => candidate.id);

    const chunkSize = 500;
    for (let i = 0; i < staleIds.length; i += chunkSize) {
      await serviceStatusRepository
        .createQueryBuilder()
        .update()
        .set(
          clearSeasonStatuses
            ? { status: MediaStatus.UNKNOWN, seasonStatuses: null }
            : { status: MediaStatus.UNKNOWN }
        )
        .whereInIds(staleIds.slice(i, i + chunkSize))
        .execute();
    }

    this.log(
      `Reset ${staleIds.length} stale service status entries for ${serverName} (${
        candidates.length - staleIds.length
      } items retained)`,
      'info'
    );

    await this.declineStaleServiceRequests(
      serviceId,
      staleCandidates.map((candidate) => Number(candidate.mediaId)),
      serverName
    );
  }

  private async declineStaleServiceRequests(
    serviceId: number,
    mediaIds: number[],
    serverName: string
  ): Promise<void> {
    const requestRepository = getRepository(MediaRequest);

    const chunkSize = 500;
    for (let i = 0; i < mediaIds.length; i += chunkSize) {
      const requests = await requestRepository.find({
        where: {
          media: { id: In(mediaIds.slice(i, i + chunkSize)) },
          isServiceRequest: true,
          serverId: serviceId,
          status: MediaRequestStatus.APPROVED,
        },
        relations: { media: true },
      });

      for (const request of requests) {
        request.status = MediaRequestStatus.DECLINED;
        await requestRepository.save(request);
        this.log(
          `Declined service request ${request.id} for ${request.media.tmdbId}, no longer found in ${serverName}.`,
          'info'
        );
      }
    }
  }

  /**
   * VSeerr: the servers of this media type, split into the standard ones
   * (non-4K, no version name) and versions. Empty when no versions are set
   * up, or when every server is a version (Seerr's behaviour then).
   */
  private versionSplit(mediaType: MediaType): {
    serviceType: 'radarr' | 'sonarr';
    versionIds: Set<number>;
    standardIds: number[];
    standardSynced: boolean;
  } {
    const settings = getSettings();
    const servers =
      mediaType === MediaType.MOVIE ? settings.radarr : settings.sonarr;
    const versionIds = versionServerIds(servers);
    const standard = servers.filter(
      (server) => !server.is4k && !versionIds.has(server.id)
    );
    return {
      serviceType: mediaType === MediaType.MOVIE ? 'radarr' : 'sonarr',
      versionIds,
      standardIds: standard.map((server) => server.id),
      standardSynced: standard.every((server) => server.syncEnabled),
    };
  }

  /**
   * VSeerr: what of a title only versions have files of, judged from the
   * statuses the Radarr/Sonarr scans record: the movie, or seasons of a
   * show. Plex and Jellyfin scans leave these out of the standard status,
   * because a shared library cannot tell whose file it has. Nothing when
   * versions are not set up or a standard server is not synced.
   */
  protected async versionOnlyParts(
    mediaId: number,
    mediaType: MediaType
  ): Promise<{ title: boolean; seasons: Set<number> }> {
    const split = this.versionSplit(mediaType);
    const none = { title: false, seasons: new Set<number>() };
    if (split.versionIds.size === 0 || !split.standardSynced) {
      return none;
    }
    const rows = await getRepository(MediaServiceStatus).find({
      where: { mediaId, serviceType: split.serviceType },
    });
    const standardRows = rows.filter((row) =>
      split.standardIds.includes(row.serviceId)
    );
    const versionRows = rows.filter((row) =>
      split.versionIds.has(row.serviceId)
    );
    const hasFiles = (status: MediaStatus | undefined) =>
      status === MediaStatus.AVAILABLE ||
      status === MediaStatus.PARTIALLY_AVAILABLE;

    if (mediaType === MediaType.MOVIE) {
      return {
        title:
          versionRows.some((row) => hasFiles(row.status)) &&
          !standardRows.some((row) => hasFiles(row.status)),
        seasons: new Set(),
      };
    }
    const seasons = new Set<number>();
    for (const row of versionRows) {
      for (const [season, status] of Object.entries(row.seasonStatuses ?? {})) {
        const n = Number(season);
        if (
          hasFiles(status) &&
          !standardRows.some((s) => hasFiles(s.seasonStatuses?.[n]))
        ) {
          seasons.add(n);
        }
      }
    }
    return { title: false, seasons };
  }

  /**
   * VSeerr: records a version server's movie. Only the version's own status
   * changes; the standard status and the standard server fields stay as the
   * standard servers left them.
   */
  protected async processVersionMovie(
    tmdbId: number,
    {
      serviceId,
      externalServiceId,
      externalServiceSlug,
      imdbId,
      title = 'Unknown Title',
      processing = false,
      hasFile = true,
    }: ProcessOptions & { serviceId: number }
  ): Promise<void> {
    await this.asyncLock.dispatch(tmdbId, async () => {
      const media = await this.versionMedia(tmdbId, MediaType.MOVIE, {
        imdbId,
        create: processing || hasFile,
      });
      if (!media) {
        return;
      }
      await this.upsertServiceStatus(
        media.id,
        serviceId,
        'radarr',
        hasFile
          ? MediaStatus.AVAILABLE
          : processing
            ? MediaStatus.PROCESSING
            : MediaStatus.UNKNOWN,
        externalServiceId,
        externalServiceSlug
      );
      this.log(`Recorded version status of ${title}`, 'debug');
    });
  }

  /** VSeerr: the show counterpart of processVersionMovie. */
  protected async processVersionShow(
    tmdbId: number,
    tvdbId: number | undefined,
    seasons: ProcessableSeason[],
    {
      serviceId,
      externalServiceId,
      externalServiceSlug,
      title = 'Unknown Title',
    }: ProcessOptions & { serviceId: number }
  ): Promise<void> {
    await this.asyncLock.dispatch(tmdbId, async () => {
      const { overall, perSeason } = this.computeSeasonServiceStatuses(
        seasons,
        false
      );
      const media = await this.versionMedia(tmdbId, MediaType.TV, {
        tvdbId,
        create: overall !== MediaStatus.UNKNOWN,
      });
      if (!media) {
        return;
      }
      await this.upsertServiceStatus(
        media.id,
        serviceId,
        'sonarr',
        overall,
        externalServiceId,
        externalServiceSlug,
        perSeason
      );
      this.log(`Recorded version status of ${title}`, 'debug');
    });
  }

  /** The title's media row; a new one starts with no standard status. */
  private async versionMedia(
    tmdbId: number,
    mediaType: MediaType,
    {
      imdbId,
      tvdbId,
      create,
    }: { imdbId?: string; tvdbId?: number; create: boolean }
  ): Promise<Media | null> {
    const mediaRepository = getRepository(Media);
    const existing = await this.getExisting(tmdbId, mediaType);
    if (existing) {
      if ((imdbId && !existing.imdbId) || (tvdbId && !existing.tvdbId)) {
        existing.imdbId = existing.imdbId ?? imdbId;
        existing.tvdbId = existing.tvdbId ?? tvdbId;
        await mediaRepository.save(existing);
      }
      return existing;
    }
    if (!create) {
      return null;
    }
    return mediaRepository.save(
      new Media({
        tmdbId,
        tvdbId,
        imdbId,
        mediaType,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );
  }

  /**
   * VSeerr: titles only versions have get the standard status the standard
   * servers give them. Older builds, and Plex or Jellyfin scans of a shared
   * library, marked them available or processing in the standard version,
   * which locked it and pointed its *arr links at the version's server.
   * Runs after a complete scan of the standard servers.
   */
  protected async repairVersionOnlyTitles(mediaType: MediaType): Promise<void> {
    const split = this.versionSplit(mediaType);
    if (split.versionIds.size === 0 || !split.standardSynced) {
      return;
    }
    const versionIds = [...split.versionIds];
    const statusRepository = getRepository(MediaServiceStatus);
    const mediaRepository = getRepository(Media);

    const fromRows = await statusRepository.find({
      select: { mediaId: true },
      where: { serviceType: split.serviceType, serviceId: In(versionIds) },
    });
    const fromServiceId = await mediaRepository.find({
      select: { id: true },
      where: { mediaType, serviceId: In(versionIds) },
    });
    const mediaIds = [
      ...new Set([
        ...fromRows.map((row) => row.mediaId),
        ...fromServiceId.map((media) => media.id),
      ]),
    ];

    const live = (status: MediaStatus | undefined) =>
      status === MediaStatus.AVAILABLE ||
      status === MediaStatus.PARTIALLY_AVAILABLE ||
      status === MediaStatus.PROCESSING;
    let repaired = 0;

    for (let i = 0; i < mediaIds.length; i += 200) {
      const chunk = mediaIds.slice(i, i + 200);
      const [medias, rows] = await Promise.all([
        mediaRepository.find({
          where: { id: In(chunk), mediaType },
          relations: { requests: true },
        }),
        statusRepository.find({
          where: { mediaId: In(chunk), serviceType: split.serviceType },
        }),
      ]);

      for (const media of medias) {
        const own = rows.filter((row) => row.mediaId === media.id);
        const standardRows = own.filter((row) =>
          split.standardIds.includes(row.serviceId)
        );
        const versionRows = own.filter((row) =>
          split.versionIds.has(row.serviceId)
        );
        const fromVersion =
          media.serviceId != null && split.versionIds.has(media.serviceId);
        const openStandard = (media.requests ?? []).filter(
          (request) =>
            !request.is4k &&
            !request.isServiceRequest &&
            (request.status === MediaRequestStatus.PENDING ||
              request.status === MediaRequestStatus.APPROVED)
        );
        const requestedStatus = (
          requests: MediaRequest[]
        ): MediaStatus | undefined =>
          requests.some((r) => r.status === MediaRequestStatus.APPROVED)
            ? MediaStatus.PROCESSING
            : requests.length > 0
              ? MediaStatus.PENDING
              : undefined;
        let changed = false;

        if (mediaType === MediaType.MOVIE) {
          if (
            live(media.status) &&
            !standardRows.some((row) => live(row.status)) &&
            (fromVersion || versionRows.some((row) => live(row.status)))
          ) {
            media.status = requestedStatus(openStandard) ?? MediaStatus.UNKNOWN;
            changed = true;
          }
        } else {
          for (const season of media.seasons ?? []) {
            const n = season.seasonNumber;
            if (
              !live(season.status) ||
              standardRows.some((row) => live(row.seasonStatuses?.[n])) ||
              !(
                fromVersion ||
                versionRows.some((row) => live(row.seasonStatuses?.[n]))
              )
            ) {
              continue;
            }
            season.status =
              requestedStatus(
                openStandard.filter((request) =>
                  (request.seasons ?? []).some((s) => s.seasonNumber === n)
                )
              ) ?? MediaStatus.UNKNOWN;
            changed = true;
          }
          if (changed) {
            media.status = this.rollUpSeasons(media);
          }
        }

        if (fromVersion) {
          const standard = standardRows.find(
            (row) =>
              row.status !== MediaStatus.UNKNOWN &&
              row.status !== MediaStatus.DELETED
          );
          media.serviceId = standard?.serviceId ?? null;
          media.externalServiceId = standard?.externalServiceId ?? null;
          media.externalServiceSlug = standard?.externalServiceSlug ?? null;
          changed = true;
        }

        if (changed) {
          // Saving the requests again could cascade stale copies.
          const { requests, ...rest } = media;
          void requests;
          await mediaRepository.save(Object.assign(new Media(), rest));
          repaired++;
        }
      }
    }

    if (repaired > 0) {
      this.log(
        `Gave ${repaired} title(s) that only versions have their standard status back`,
        'info'
      );
    }
  }

  /** The standard status of a show from its seasons (specials aside). */
  private rollUpSeasons(media: Media): MediaStatus {
    const seasons = (media.seasons ?? []).filter((s) => s.seasonNumber !== 0);
    const has = (status: MediaStatus) =>
      seasons.some((season) => season.status === status);
    if (
      seasons.length > 0 &&
      seasons.every((season) => season.status === MediaStatus.AVAILABLE)
    ) {
      return MediaStatus.AVAILABLE;
    }
    if (has(MediaStatus.AVAILABLE) || has(MediaStatus.PARTIALLY_AVAILABLE)) {
      return MediaStatus.PARTIALLY_AVAILABLE;
    }
    if (has(MediaStatus.PROCESSING)) {
      return MediaStatus.PROCESSING;
    }
    if (has(MediaStatus.PENDING) || media.status === MediaStatus.PENDING) {
      return MediaStatus.PENDING;
    }
    return media.status === MediaStatus.DELETED
      ? MediaStatus.DELETED
      : MediaStatus.UNKNOWN;
  }

  get protectedUpdateRate(): number {
    return this.updateRate;
  }

  get protectedBundleSize(): number {
    return this.bundleSize;
  }
}

export default BaseScanner;
