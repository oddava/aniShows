import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { animeApi } from '../../api/client';
import { animeKeys, animeQueries } from '../../api/queries/anime';
import {
    DETAIL_RELATION_PAGE_SIZE,
    WATCH_PREVIEW_PAGE_SIZE,
    WATCH_TAB_PAGE_SIZE,
} from './animeDetailTabs';

/**
 * Data for the anime detail tabs: characters, staff, the watch preview and
 * episode list, episode ratings and recommendations, each fetched only for
 * the tab that shows it, plus the derived totals and the episode-rating
 * mutations. Called from AnimeDetail before its loading return so the
 * queries keep their timing. Overview fetches only the 4-episode preview;
 * the 50-episode Watch page loads when the Watch tab opens.
 */
export default function useAnimeDetailTabData({ slug, user, anime, activeTab, queryClient, loadRecommendations = true }) {
    const watchPreviewQueryKey = useMemo(() => animeKeys.watchPreview(slug), [slug]);
    const watchEpisodesQueryKey = useMemo(() => animeKeys.watchEpisodes(slug, WATCH_TAB_PAGE_SIZE), [slug]);
    const shouldLoadWatchPreview = activeTab === 'overview';
    const shouldLoadWatchTab = activeTab === 'watch';
    const hasStaff = (anime?.staff_count || 0) > 0 || (anime?.staff_preview?.length || 0) > 0;

    const {
        data: charactersData,
        fetchNextPage: fetchNextCharactersPage,
        hasNextPage: hasNextCharactersPage,
        isFetchingNextPage: isFetchingNextCharactersPage,
        isLoading: charactersLoading,
    } = useInfiniteQuery({
        ...animeQueries.characters(slug, DETAIL_RELATION_PAGE_SIZE),
        enabled: !!anime && activeTab === 'characters',
        staleTime: Infinity, // Character lists rarely change
    });

    const {
        data: staffData,
        fetchNextPage: fetchNextStaffPage,
        hasNextPage: hasNextStaffPage,
        isFetchingNextPage: isFetchingNextStaffPage,
        isLoading: staffLoading,
    } = useInfiniteQuery({
        ...animeQueries.staff(slug, DETAIL_RELATION_PAGE_SIZE),
        // Overview shows the key crew picked from the first page (the inline
        // preview is just the first few credits, usually producers).
        enabled: !!anime && (activeTab === 'staff' || (activeTab === 'overview' && hasStaff)),
        staleTime: Infinity, // Staff lists rarely change
    });

    const {
        data: watchPreviewData,
    } = useQuery({
        ...animeQueries.watchPreview(slug, WATCH_PREVIEW_PAGE_SIZE),
        enabled: !!anime && shouldLoadWatchPreview,
        staleTime: 300000,
    });

    const {
        data: watchEpisodesData,
        fetchNextPage: fetchNextWatchEpisodesPage,
        hasNextPage: hasNextWatchEpisodesPage,
        isFetchingNextPage: isFetchingNextWatchEpisodesPage,
        isLoading: watchEpisodesLoading,
        isError: watchEpisodesIsError,
        refetch: refetchWatchEpisodes,
    } = useInfiniteQuery({
        ...animeQueries.watchEpisodes(slug, WATCH_TAB_PAGE_SIZE),
        enabled: !!anime && shouldLoadWatchTab,
        staleTime: 300000,
    });

    const {
        data: episodeRatings,
        isLoading: episodeRatingsLoading,
    } = useQuery({
        ...animeQueries.episodeRatings(slug, user?.id),
        enabled: !!anime && (activeTab === 'watch' || activeTab === 'stats'),
        staleTime: 60000,
    });

    // Only once the sidebar is about to show (see useNearViewport): on a cold
    // key the backend may spend an AniList call, and crawlers render JS.
    const { data: recommendations } = useQuery({
        ...animeQueries.recommendations(slug),
        enabled: !!anime && loadRecommendations,
        staleTime: 30 * 60 * 1000,
    });

    const watchEpisodes = useMemo(() =>
        watchEpisodesData?.pages.flatMap((page) => page?.results || []) || [],
        [watchEpisodesData]
    );
    const characters = useMemo(() =>
        charactersData?.pages.flatMap((page) => page?.results || []) || [],
        [charactersData]
    );
    const staff = useMemo(() =>
        staffData?.pages.flatMap((page) => page?.results || []) || [],
        [staffData]
    );
    const previewEpisodes = useMemo(
        () => watchPreviewData?.results || [],
        [watchPreviewData]
    );
    const displayEpisodes = activeTab === 'watch' ? watchEpisodes : previewEpisodes;
    const rawWatchEpisodesCount = watchEpisodesData?.pages?.[0]?.count ?? watchPreviewData?.count;
    const parsedWatchEpisodesCount = Number(rawWatchEpisodesCount);
    const watchEpisodesTotal = Number.isFinite(parsedWatchEpisodesCount) && parsedWatchEpisodesCount >= 0
        ? parsedWatchEpisodesCount
        : (anime?.episode_count || 0);
    const rawCharacterCount = charactersData?.pages?.[0]?.count;
    const parsedCharacterCount = Number(rawCharacterCount);
    const charactersTotal = Number.isFinite(parsedCharacterCount) && parsedCharacterCount >= 0
        ? parsedCharacterCount
        : (anime?.character_count || 0);
    const rawStaffCount = staffData?.pages?.[0]?.count;
    const parsedStaffCount = Number(rawStaffCount);
    const staffTotal = Number.isFinite(parsedStaffCount) && parsedStaffCount >= 0
        ? parsedStaffCount
        : (anime?.staff_count || 0);

    const setEpisodeRatingMutation = useMutation({
        mutationFn: ({ episodeNumber, rating }) =>
            animeApi.setEpisodeRating(slug, episodeNumber, { rating }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: watchEpisodesQueryKey });
            queryClient.invalidateQueries({ queryKey: watchPreviewQueryKey });
            queryClient.invalidateQueries({ queryKey: animeKeys.episodeRatingsAll(slug) });
        },
    });

    const clearEpisodeRatingMutation = useMutation({
        mutationFn: (episodeNumber) => animeApi.clearEpisodeRating(slug, episodeNumber),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: watchEpisodesQueryKey });
            queryClient.invalidateQueries({ queryKey: watchPreviewQueryKey });
            queryClient.invalidateQueries({ queryKey: animeKeys.episodeRatingsAll(slug) });
        },
    });

    const handleEpisodeRatingChange = useCallback(async (episodeNumber, rating) => {
        await setEpisodeRatingMutation.mutateAsync({ episodeNumber, rating });
    }, [setEpisodeRatingMutation]);

    const handleEpisodeRatingClear = useCallback(async (episodeNumber) => {
        await clearEpisodeRatingMutation.mutateAsync(episodeNumber);
    }, [clearEpisodeRatingMutation]);

    return {
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
        recommendations,
        setEpisodeRatingMutation,
        clearEpisodeRatingMutation,
        handleEpisodeRatingChange,
        handleEpisodeRatingClear,
    };
}
