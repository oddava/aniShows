import { useInfiniteQuery } from '@tanstack/react-query';
import { animeApi } from '../api/client';

/**
 * Hook to fetch anime with infinite scroll/pagination
 */
export function useInfiniteAnime({
    currentGenres,
    currentSort,
    currentSearch,
    currentTypes,
    currentStatuses,
    currentStudio,
    currentSeason,
    currentYear,
    currentMinRating,
    currentMaxRating,
    pageSize = 12,
}) {
    return useInfiniteQuery({
        queryKey: [
            'anime',
            'list',
            {
                genres: currentGenres,
                sort: currentSort,
                search: currentSearch,
                type: currentTypes,
                status: currentStatuses,
                studio: currentStudio,
                season: currentSeason,
                year: currentYear,
                minRating: currentMinRating,
                maxRating: currentMaxRating,
            }
        ],
        queryFn: ({ pageParam = 1 }) =>
            animeApi.getAll({
                page: pageParam,
                page_size: pageSize,
                genre: currentGenres.length > 0 ? currentGenres.join(',') : undefined,
                sort: currentSort,
                q: currentSearch || undefined,
                type: currentTypes || undefined,
                status: currentStatuses || undefined,
                studio: currentStudio || undefined,
                season: currentSeason || undefined,
                year: currentYear || undefined,
                min_rating: currentMinRating || undefined,
                max_rating: currentMaxRating || undefined,
            }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                const url = new URL(lastPage.next);
                return url.searchParams.get('page');
            }
            return undefined;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

export default useInfiniteAnime;
