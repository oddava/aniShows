import { Check, CheckCheck, Loader, X } from 'lucide-react';
import CustomSelect from './common/CustomSelect';
import useListEntryMutation from '../hooks/useListEntryMutation';
import { meaningfulEpisodeTitle } from './detailTabs/format';

const RATING_OPTIONS = ['5.0', '4.5', '4.0', '3.5', '3.0', '2.5', '2.0', '1.5', '1.0', '0.5'];

export default function EpisodesTab({
    anime,
    accentColor,
    episodes,
    isAuthenticated,
    totalCount,
    isLoading,
    hasError,
    hasNextPage,
    isFetchingNextPage,
    ratingPendingEpisodeNumber,
    onRateEpisode,
    onClearEpisodeRating,
    onLoadMore,
    onRetry,
    listEntry,
}) {
    // G2 passes `listEntry` (the anime's `user_list_status`); until then read it off the anime.
    const resolvedEntry = listEntry !== undefined ? listEntry : anime?.user_list_status;
    const { entry, setProgress, isPending: isProgressPending } = useListEntryMutation({
        anime: { id: anime?.id, slug: anime?.slug, episode_count: anime?.episode_count },
        entry: resolvedEntry,
    });
    const watchedThrough = entry.id ? entry.episodes_watched || 0 : 0;
    const canTrackProgress = Boolean(isAuthenticated && anime?.id);
    const duration = anime?.duration_minutes || 24;
    const resolvedCount = Number.isFinite(totalCount) && totalCount > 0 ? totalCount : episodes.length;

    if (isLoading && episodes.length === 0) {
        return (
            <div className="flex justify-center items-center py-24 animate-tab-content" data-testid="watch-tab">
                <Loader className="w-8 h-8 text-[var(--text-3)] animate-spin" aria-label="Loading episodes" />
            </div>
        );
    }

    if (hasError && episodes.length === 0) {
        return (
            <div className="py-10 animate-tab-content" data-testid="watch-tab">
                <p className="text-[15px] text-[var(--text-2)]">
                    Couldn’t load the episodes.{' '}
                    <button type="button" onClick={onRetry} className="text-link">
                        Try again
                    </button>
                </p>
            </div>
        );
    }

    if (episodes.length === 0) {
        return (
            <div className="py-10 animate-tab-content" data-testid="watch-tab">
                <p className="text-[15px] text-[var(--text-2)]">No episodes listed for this one yet.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-4" data-testid="watch-tab">
            <p className="text-sm text-[var(--text-3)] tabular">
                {episodes.length < resolvedCount ? `Showing ${episodes.length} of ${resolvedCount} episodes` : `${resolvedCount} episodes`}
                {' · '}about {duration} min each
            </p>

            <div className="min-w-0 space-y-1">
                {episodes.map((episode) => {
                    const publicAverage = episode.average_rating != null ? Number(episode.average_rating) : null;
                    const ratingCount = Number(episode.rating_count || 0);
                    const userRatingValue = episode.user_rating != null ? String(episode.user_rating) : '';
                    const isRatingPending = ratingPendingEpisodeNumber === episode.number;
                    const isWatched = episode.number <= watchedThrough;
                    const title = meaningfulEpisodeTitle(episode);

                    return (
                        <article
                            key={episode.number}
                            className="relative group min-w-0 overflow-visible rounded-[var(--radius-md)] -mx-3 px-3 py-3 transition-colors hover:bg-white/[0.03] focus-within:z-30"
                        >
                            <a 
                                href={episode.crunchyroll_url}
                                target="_blank"
                                rel="noreferrer"
                                className="absolute inset-0 z-0"
                                aria-label={`Watch episode ${episode.number}`}
                            >
                                <span className="sr-only">Watch episode {episode.number}</span>
                            </a>

                            <div className="relative z-10 flex min-w-0 items-start justify-between gap-3 sm:gap-4">
                                <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-3.5 pointer-events-none">
                                    {episode.thumbnail && (
                                        <div className="relative aspect-video w-20 sm:w-32 flex-shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)]">
                                            <img
                                                src={episode.thumbnail}
                                                alt={`${anime?.title || 'Anime'} episode ${episode.number}`}
                                                loading="lazy"
                                                className="absolute inset-0 h-full w-full object-cover"
                                            />
                                        </div>
                                    )}

                                    <div className="min-w-0 flex-1">
                                        <h3 className="truncate text-[15px] font-medium text-[var(--text-1)] transition-colors group-hover:text-[var(--signature)]">
                                            {title ? (
                                                <>
                                                    <span className="mr-2 tabular text-[var(--text-3)]">{episode.number}</span>
                                                    {title}
                                                </>
                                            ) : (
                                                `Episode ${episode.number}`
                                            )}
                                        </h3>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[var(--text-3)]">
                                            {episode.aired && <span className="flex-shrink-0">{episode.aired}</span>}
                                            {episode.aired && <span className="flex-shrink-0">•</span>}
                                            <span className="flex-shrink-0">{duration} min</span>
                                            {isWatched && (
                                                <>
                                                    <span className="flex-shrink-0">•</span>
                                                    <span className="inline-flex flex-shrink-0 items-center gap-1 text-[var(--status-watching)]">
                                                        <Check className="h-3 w-3" aria-hidden="true" />
                                                        Watched
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                        {publicAverage != null && ratingCount > 0 && (
                                            <div className="mt-1 flex flex-wrap items-baseline gap-1.5 text-sm tabular">
                                                <span className="text-[var(--text-2)]">{publicAverage.toFixed(2)}</span>
                                                <span className="text-[var(--text-3)]">({ratingCount})</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {isAuthenticated && (
                                    <div className="flex shrink-0 self-center items-center gap-1.5 sm:gap-2">
                                        {canTrackProgress && episode.number !== watchedThrough && (
                                            <button
                                                type="button"
                                                disabled={isProgressPending}
                                                onClick={() => setProgress(episode.number)}
                                                className="inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-white/[0.08] px-2.5 text-sm text-[var(--text-2)] transition-colors hover:border-white/20 hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label={`Watched through here (episode ${episode.number})`}
                                            >
                                                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                                                <span className="hidden sm:inline">Watched through here</span>
                                            </button>
                                        )}
                                        <label htmlFor={`episode-rating-${episode.number}`} className="sr-only">
                                            Rate episode {episode.number}
                                        </label>
                                        <CustomSelect
                                            id={`episode-rating-${episode.number}`}
                                            value={userRatingValue}
                                            disabled={isRatingPending}
                                            onChange={(nextValue) => {
                                                if (!nextValue) return;
                                                onRateEpisode?.(episode.number, nextValue);
                                            }}
                                            options={[
                                                { value: '', label: 'Rate' },
                                                ...RATING_OPTIONS.map((option) => ({
                                                    value: option,
                                                    label: option,
                                                })),
                                            ]}
                                            className="min-w-[70px] sm:min-w-[80px]"
                                            triggerClassName="!min-h-10 !rounded-[var(--radius-sm)] !border !border-white/[0.08] !bg-transparent !px-2.5 !py-1 !text-sm text-[var(--text-2)]"
                                            menuClassName="z-[320]"
                                            ariaLabel={`Rate episode ${episode.number}`}
                                        />
                                        <button
                                            type="button"
                                            disabled={!userRatingValue || isRatingPending}
                                            onClick={() => onClearEpisodeRating?.(episode.number)}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40"
                                            aria-label={`Clear rating for episode ${episode.number}`}
                                        >
                                            {isRatingPending ? <Loader className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>

            {hasNextPage && (
                <div className="flex justify-center pt-2">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={isFetchingNextPage}
                        className="btn-secondary text-[15px] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isFetchingNextPage && <Loader className="h-4 w-4 animate-spin" />}
                        {isFetchingNextPage ? 'Loading…' : 'Load more episodes'}
                    </button>
                </div>
            )}
        </div>
    );
}
