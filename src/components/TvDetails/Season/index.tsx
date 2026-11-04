import AirDateBadge from '@app/components/AirDateBadge';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import EpisodeAvailability from '@app/components/TvDetails/Season/EpisodeAvailability';
import EpisodeVersions from '@app/components/TvDetails/Season/EpisodeVersions';
import defineMessages from '@app/utils/defineMessages';
import type { SeasonHolder } from '@app/utils/seasonVersions';
import { episodeMarks, hasAired } from '@app/utils/seasonVersions';
import type { SeasonEpisodeVersionsResponse } from '@server/lib/mediaVersions';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.TvDetails.Season', {
  somethingwentwrong: 'Something went wrong while retrieving season data.',
  noepisodes: 'Episode list unavailable.',
});

type SeasonProps = {
  seasonNumber: number;
  tvId: number;
  /** VSeerr: set when a version holds files in this season. */
  mediaId?: number;
  /** VSeerr: the versions with files in this season, for episode marks. */
  holders?: SeasonHolder[];
};

const Season = ({ seasonNumber, tvId, mediaId, holders = [] }: SeasonProps) => {
  const intl = useIntl();
  const { data, error } = useSWR<SeasonWithEpisodes>(
    `/api/v1/tv/${tvId}/season/${seasonNumber}`
  );
  // VSeerr: which versions hold each episode, and what each file contains.
  const { data: episodeVersions } = useSWR<SeasonEpisodeVersionsResponse>(
    mediaId ? `/api/v1/media/${mediaId}/versions/season/${seasonNumber}` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <div>{intl.formatMessage(messages.somethingwentwrong)}</div>;
  }

  return (
    <div className="flex flex-col justify-center divide-y divide-gray-700">
      {data.episodes.length === 0 ? (
        <p>{intl.formatMessage(messages.noepisodes)}</p>
      ) : (
        data.episodes
          .slice()
          .reverse()
          .map((episode) => {
            return (
              <div
                className="flex flex-col space-y-4 py-4 xl:flex-row xl:space-x-4 xl:space-y-4"
                key={`season-${seasonNumber}-episode-${episode.episodeNumber}`}
              >
                <div className="flex-1">
                  <div className="flex flex-col space-y-2 xl:flex-row xl:items-center xl:space-x-2 xl:space-y-0">
                    <h3 className="text-lg">
                      {episode.episodeNumber} - {episode.name}
                    </h3>
                    {episode.airDate && (
                      <AirDateBadge airDate={episode.airDate} />
                    )}
                    <EpisodeAvailability
                      marks={episodeMarks(
                        holders,
                        episode.episodeNumber,
                        hasAired(episode.airDate)
                      )}
                      labelled={holders.length > 1}
                    />
                  </div>
                  <EpisodeVersions
                    versions={
                      episodeVersions?.episodes.find(
                        (e) => e.episodeNumber === episode.episodeNumber
                      )?.versions
                    }
                  />
                  {episode.overview && <p>{episode.overview}</p>}
                </div>
                {episode.stillPath && (
                  <div className="relative aspect-video xl:h-32">
                    <CachedImage
                      type="tmdb"
                      className="rounded-lg object-contain"
                      src={episode.stillPath}
                      alt=""
                      fill
                    />
                  </div>
                )}
              </div>
            );
          })
      )}
    </div>
  );
};

export default Season;
