import { Suspense, lazy } from 'react';
import { OverviewTab, CharactersTab, StaffTab, ThemesTab } from '../DetailTabs';
import EpisodesTab from '../EpisodesTab';

// recharts is heavy; load it only when the Stats tab is opened.
const StatsTab = lazy(() => import('../StatsTab'));

/** The body of the active detail tab. `tabData` is the state from useAnimeDetailTabData. */
export default function AnimeDetailTabContent({ activeTab, anime, accentColor, isAuthenticated, tabData }) {
    const {
        characters,
        charactersLoading,
        charactersTotal,
        hasNextCharactersPage,
        isFetchingNextCharactersPage,
        fetchNextCharactersPage,
        staff,
        staffLoading,
        staffTotal,
        hasNextStaffPage,
        isFetchingNextStaffPage,
        fetchNextStaffPage,
        displayEpisodes,
        watchEpisodesTotal,
        watchEpisodesLoading,
        watchEpisodesIsError,
        hasNextWatchEpisodesPage,
        isFetchingNextWatchEpisodesPage,
        fetchNextWatchEpisodesPage,
        refetchWatchEpisodes,
        episodeRatings,
        episodeRatingsLoading,
        setEpisodeRatingMutation,
        clearEpisodeRatingMutation,
        handleEpisodeRatingChange,
        handleEpisodeRatingClear,
    } = tabData;

    return (
        <div className="min-h-[300px]">
            {activeTab === 'overview' && (
                <OverviewTab
                    anime={anime}
                    accentColor={accentColor}
                    characters={anime.characters_preview}
                    staff={anime.staff_preview}
                    episodes={displayEpisodes}
                />
            )}
            {activeTab === 'watch' && (
                <EpisodesTab
                    anime={anime}
                    accentColor={accentColor}
                    episodes={displayEpisodes}
                    isAuthenticated={isAuthenticated}
                    totalCount={watchEpisodesTotal}
                    isLoading={watchEpisodesLoading}
                    hasError={watchEpisodesIsError}
                    hasNextPage={hasNextWatchEpisodesPage}
                    isFetchingNextPage={isFetchingNextWatchEpisodesPage}
                    ratingPendingEpisodeNumber={
                        setEpisodeRatingMutation.isPending
                            ? setEpisodeRatingMutation.variables?.episodeNumber
                            : clearEpisodeRatingMutation.isPending
                                ? clearEpisodeRatingMutation.variables
                                : null
                    }
                    onRateEpisode={handleEpisodeRatingChange}
                    onClearEpisodeRating={handleEpisodeRatingClear}
                    onLoadMore={fetchNextWatchEpisodesPage}
                    onRetry={refetchWatchEpisodes}
                />
            )}
            {activeTab === 'themes' && (
                <ThemesTab anime={anime} accentColor={accentColor} />
            )}
            {activeTab === 'stats' && (
                <Suspense fallback={<div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
                    <StatsTab
                        anime={anime}
                        accentColor={accentColor}
                        episodeRatings={episodeRatings || []}
                        isEpisodeRatingsLoading={episodeRatingsLoading}
                    />
                </Suspense>
            )}
            {activeTab === 'characters' && (
                <CharactersTab
                    anime={anime}
                    characters={characters}
                    isLoading={charactersLoading}
                    totalCount={charactersTotal}
                    hasNextPage={hasNextCharactersPage}
                    isFetchingNextPage={isFetchingNextCharactersPage}
                    onLoadMore={fetchNextCharactersPage}
                />
            )}
            {activeTab === 'staff' && (
                <StaffTab
                    anime={anime}
                    staff={staff}
                    isLoading={staffLoading}
                    totalCount={staffTotal}
                    hasNextPage={hasNextStaffPage}
                    isFetchingNextPage={isFetchingNextStaffPage}
                    onLoadMore={fetchNextStaffPage}
                />
            )}
        </div>
    );
}
