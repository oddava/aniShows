import { Loader, Play, Search, Tv } from 'lucide-react';

export default function EpisodesTab({
    anime,
    accentColor,
    episodes,
    totalCount,
    isLoading,
    hasError,
    hasNextPage,
    isFetchingNextPage,
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
        <div className="animate-tab-content min-w-0 space-y-4" data-testid="watch-tab">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-dark-200/30 px-4 py-3 text-xs text-gray-400">
                <div>
                    Loaded <span className="font-bold text-gray-300">{episodes.length}</span> of <span className="font-bold text-gray-300">{resolvedCount}</span> episodes
                </div>
                <div>{duration}m average runtime</div>
            </div>

            <div className="grid min-w-0 gap-3">
                {episodes.map((episode) => (
                    <article
                        key={episode.number}
                        className="group flex flex-row items-center justify-between gap-4 rounded-xl border border-white/5 bg-dark-200/40 p-3 transition-colors hover:border-gray-600 min-w-0 overflow-hidden"
                    >
                        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                            {episode.thumbnail && (
                                <div className="relative aspect-video w-24 sm:w-32 flex-shrink-0 overflow-hidden rounded-lg bg-dark-200 border border-transparent group-hover:border-white/10 transition-colors">
                                    <img
                                        src={episode.thumbnail}
                                        alt={`${anime?.title || 'Anime'} episode ${episode.number}`}
                                        loading="lazy"
                                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-bold text-gray-200 group-hover:text-white transition-colors truncate">
                                    <span className="text-gray-500 mr-1.5 sm:mr-2 flex-shrink-0">EP {episode.number}</span>
                                    {episode.title || `Episode ${episode.number}`}
                                </h3>
                                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 font-medium truncate">
                                    {episode.aired && (
                                        <>
                                            <span className="flex-shrink-0">{episode.aired}</span>
                                            <span className="flex-shrink-0">•</span>
                                        </>
                                    )}
                                    <span className="flex-shrink-0">{duration}m</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex-shrink-0 sm:flex sm:items-center">
                            <a
                                href={episode.crunchyroll_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white transition-all bg-white/5 hover:!bg-[var(--hover-accent)] active:scale-95 w-full sm:w-auto"
                                style={{ '--hover-accent': accentColor || '#75698d' }}
                            >
                                {episode.has_real_crunchyroll_url ? (
                                    <Play className="h-3.5 w-3.5 fill-current flex-shrink-0" />
                                ) : (
                                    <Search className="h-3.5 w-3.5 flex-shrink-0" />
                                )}
                                <span className="truncate">
                                    {episode.has_real_crunchyroll_url ? 'Watch' : 'Search'}
                                </span>
                            </a>
                        </div>
                    </article>
                ))}
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
