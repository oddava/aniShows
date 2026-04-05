import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { animeApi } from '../api/client';

/**
 * Hook for prefetching anime data to improve perceived performance
 */
export function usePrefetchAnime() {
    const queryClient = useQueryClient();

    /**
     * Prefetch the next page of anime results
     * @param {Object} currentParams - Current query parameters
     * @param {number|string} nextPage - The page number to prefetch
     */
    const prefetchNextPage = useCallback((currentParams, nextPage) => {
        if (!nextPage) return;

        const queryKey = [
            'anime',
            'list',
            currentParams.genres?.join(',') || '',
            currentParams.tags?.join(',') || '',
            currentParams.sort || 'popular',
            currentParams.search || '',
            currentParams.type || '',
            currentParams.status || '',
            currentParams.studio || '',
            currentParams.season || '',
            currentParams.year || '',
            currentParams.minRating || '',
            currentParams.maxRating || '',
            currentParams.source || '',
            currentParams.minEpisodes || '',
            currentParams.maxEpisodes || '',
            currentParams.minDuration || '',
            currentParams.maxDuration || '',
            currentParams.minYear || '',
            currentParams.maxYear || '',
        ];

        // Prefetch with shorter stale time since it's the next page
        queryClient.prefetchInfiniteQuery({
            queryKey,
            queryFn: ({ pageParam = nextPage }) =>
                animeApi.getAll({
                    page: pageParam,
                    page_size: currentParams.pageSize || 12,
                    genre: currentParams.genres?.length > 0 ? currentParams.genres.join(',') : undefined,
                    tags: currentParams.tags?.length > 0 ? currentParams.tags.join(',') : undefined,
                    sort: currentParams.sort,
                    q: currentParams.search || undefined,
                    type: currentParams.type || undefined,
                    status: currentParams.status || undefined,
                    studio: currentParams.studio || undefined,
                    season: currentParams.season || undefined,
                    year: currentParams.year || undefined,
                    min_rating: currentParams.minRating || undefined,
                    max_rating: currentParams.maxRating || undefined,
                    source: currentParams.source || undefined,
                    min_episodes: currentParams.minEpisodes || undefined,
                    max_episodes: currentParams.maxEpisodes || undefined,
                    min_duration: currentParams.minDuration || undefined,
                    max_duration: currentParams.maxDuration || undefined,
                    min_year: currentParams.minYear || undefined,
                    max_year: currentParams.maxYear || undefined,
                }).then(res => res.data),
            staleTime: 1000 * 60 * 2, // 2 minutes for prefetched data
        });
    }, [queryClient]);

    /**
     * Prefetch anime detail data on hover
     * @param {string|number} animeId - The anime ID to prefetch
     */
    const prefetchAnimeDetail = useCallback((animeId) => {
        if (!animeId) return;

        queryClient.prefetchQuery({
            queryKey: ['anime', animeId, 'anonymous'],
            queryFn: () => animeApi.getBySlug(animeId).then(res => res.data),
            staleTime: 1000 * 60 * 10, // 10 minutes for detail pages
        });
    }, [queryClient]);

    /**
     * Prefetch trending anime data
     */
    const prefetchTrending = useCallback(() => {
        queryClient.prefetchQuery({
            queryKey: ['anime', 'hero-trending'],
            queryFn: () => animeApi.getTrending().then(res => res.data),
            staleTime: 1000 * 60 * 15, // 15 minutes for trending
        });
    }, [queryClient]);

    /**
     * Prefetch top rated anime
     */
    const prefetchTopRated = useCallback(() => {
        queryClient.prefetchQuery({
            queryKey: ['anime', 'top-rated'],
            queryFn: () => animeApi.getTopRated().then(res => res.data),
            staleTime: 1000 * 60 * 20, // 20 minutes for top rated
        });
    }, [queryClient]);

    return {
        prefetchNextPage,
        prefetchAnimeDetail,
        prefetchTrending,
        prefetchTopRated,
    };
}

export default usePrefetchAnime;
