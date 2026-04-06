import { Loader, Star, Tv, X } from 'lucide-react';
import CustomSelect from './common/CustomSelect';

const RATING_OPTIONS = ['0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0'];

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
}) {
    const duration = anime?.duration_minutes || 24;
    const resolvedCount = Number.isFinite(totalCount) && totalCount > 0 ? totalCount : episodes.length;

    if (isLoading && episodes.length === 0) {
        return (
            <div className="flex justify-center items-center py-24 animate-tab-content" data-testid="watch-tab">
                <Loader className="w-10 h-10 text-accent animate-spin" />
            </div>
        );
    }

    if (hasError && episodes.length === 0) {
        return (
            <div className="text-center py-12 animate-tab-content" data-testid="watch-tab">
                <Tv className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-300 text-sm">Could not load episodes.</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-4 inline-flex items-center justify-center rounded-lg border border-white/10 bg-dark-100 px-4 py-2 text-sm font-bold text-gray-200 transition-colors hover:border-white/20 hover:text-white"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (episodes.length === 0) {
        return (
            <div className="text-center py-12 animate-tab-content" data-testid="watch-tab">
                <p className="text-gray-400 text-sm">No episodes available.</p>
            </div>
        );
    }

    return (
        <div className="animate-tab-content min-w-0 space-y-3 sm:space-y-4" data-testid="watch-tab">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 rounded-xl border border-white/5 bg-dark-200/30 px-3 py-2.5 sm:px-4 sm:py-3 text-[11px] sm:text-xs text-gray-400">
                <div>
                    Loaded <span className="font-bold text-gray-300">{episodes.length}</span> of <span className="font-bold text-gray-300">{resolvedCount}</span> episodes
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span>{duration}m avg. runtime</span>
                </div>
            </div>

            <div className="grid min-w-0 gap-2 sm:gap-3">
                {episodes.map((episode) => {
                    const publicAverage = episode.average_rating != null ? Number(episode.average_rating) : null;
                    const ratingCount = Number(episode.rating_count || 0);
                    const userRatingValue = episode.user_rating != null ? String(episode.user_rating) : '';
                    const isRatingPending = ratingPendingEpisodeNumber === episode.number;

                    return (
                        <article
                            key={episode.number}
                            className="relative group flex flex-col justify-between gap-3 rounded-lg sm:rounded-xl border border-white/5 bg-dark-200/40 p-2 sm:p-3 transition-colors hover:border-gray-600 hover:bg-dark-200/60 min-w-0 overflow-hidden md:flex-row md:items-center md:gap-4"
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
                            
                            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 relative z-10 pointer-events-none">
                                {episode.thumbnail && (
                                    <div className="relative aspect-video w-20 sm:w-32 flex-shrink-0 overflow-hidden rounded-md sm:rounded-lg bg-dark-200 border border-transparent group-hover:border-white/10 transition-colors">
                                        <img
                                            src={episode.thumbnail}
                                            alt={`${anime?.title || 'Anime'} episode ${episode.number}`}
                                            loading="lazy"
                                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        />
                                    </div>
                                )}

                                <div className="flex-1 min-w-0">
                                    <h3 className="text-xs sm:text-sm font-bold text-gray-200 group-hover:text-white transition-colors truncate">
                                        <span className="text-gray-500 mr-1.5 sm:mr-2 flex-shrink-0">EP {episode.number}</span>
                                        {episode.title || `Episode ${episode.number}`}
                                    </h3>
                                    <div className="mt-0.5 sm:mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-gray-500 font-medium">
                                        {episode.aired && <span className="flex-shrink-0">{episode.aired}</span>}
                                        {episode.aired && <span className="flex-shrink-0">•</span>}
                                        <span className="flex-shrink-0">{duration}m</span>
                                    </div>
                                    {publicAverage != null && ratingCount > 0 && (
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                                            <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
                                                <Star className="h-3 w-3 fill-current" />
                                                {publicAverage.toFixed(2)}
                                            </span>
                                            <span className="text-gray-500">
                                                ({ratingCount})
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 md:items-end relative z-10">
                                {isAuthenticated && (
                                    <div className="flex items-center gap-2">
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
                                            className="min-w-[88px]"
                                            triggerClassName="rounded-lg bg-dark-100 px-2 py-1.5 text-xs sm:px-3 sm:py-2"
                                            menuClassName="z-[320]"
                                            ariaLabel={`Rate episode ${episode.number}`}
                                        />
                                        <button
                                            type="button"
                                            disabled={!userRatingValue || isRatingPending}
                                            onClick={() => onClearEpisodeRating?.(episode.number)}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-dark-100 text-gray-400 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-dark-100 px-5 py-2.5 text-sm font-bold text-gray-200 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isFetchingNextPage && <Loader className="h-4 w-4 animate-spin" />}
                        {isFetchingNextPage ? 'Loading...' : 'Load More Episodes'}
                    </button>
                </div>
            )}
        </div>
    );
}
