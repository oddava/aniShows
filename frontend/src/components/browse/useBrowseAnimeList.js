import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { animeApi } from '../../api/client';
import { getNextPageNumber } from '../../api/pagination';
import { animeKeys } from '../../api/queries/anime';

/** Index of `search` in animeKeys.browseList(...). */
const SEARCH_KEY_INDEX = 5;

/**
 * Keep the previous grid on screen (dimmed) while a filter or sort change
 * loads, but never across a new search: a new query clears to skeletons, so
 * the heading and the cards always belong to the same search (B1). The
 * superseded request is aborted by React Query (the signal is passed down).
 */
export function keepPreviousUnlessNewSearch(previousData, previousQuery, currentSearch) {
  if (!previousData || !previousQuery) return undefined;
  const previousSearch = previousQuery.queryKey?.[SEARCH_KEY_INDEX] || '';
  return previousSearch === (currentSearch || '') ? previousData : undefined;
}
import { usePrefetchAnime } from '../../hooks/usePrefetchAnime';

/**
 * The Browse result list for the current URL filters: an infinite query (only
 * in grid mode, i.e. when a filter or sort is set) and the next-page sentinel
 * (`loadMoreRef`) with its prefetch.
 * `filters` is the object from useBrowseUrlFilters.
 */
export default function useBrowseAnimeList({ filters, adultContentEnabled }) {
  const {
    currentGenres,
    currentTags,
    currentSort,
    currentSearch,
    currentTypes,
    currentStatuses,
    currentStudio,
    currentSeason,
    currentYear,
    currentExcludeIds,
    currentShelf,
    currentMinRating,
    currentMaxRating,
    currentSource,
    currentMinEpisodes,
    currentMaxEpisodes,
    currentMinDuration,
    currentMaxDuration,
    currentMinYear,
    currentMaxYear,
    isGridMode,
  } = filters;
  const { prefetchNextPage } = usePrefetchAnime();

  // Fetch anime
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  } = useInfiniteQuery({
    queryKey: animeKeys.browseList({
      genres: currentGenres.join(','),
      tags: currentTags.join(','),
      sort: currentSort,
      search: currentSearch,
      type: currentTypes,
      status: currentStatuses,
      studio: currentStudio,
      season: currentSeason,
      year: currentYear,
      excludeIds: currentExcludeIds,
      shelf: currentShelf,
      minRating: currentMinRating,
      maxRating: currentMaxRating,
      source: currentSource,
      minEpisodes: currentMinEpisodes,
      maxEpisodes: currentMaxEpisodes,
      minDuration: currentMinDuration,
      maxDuration: currentMaxDuration,
      minYear: currentMinYear,
      maxYear: currentMaxYear,
      adultContentEnabled,
    }),
    queryFn: ({ pageParam, signal }) =>
      animeApi.getAll({
        page: pageParam,
        page_size: 12,
        genre: currentGenres.length > 0 ? currentGenres.join(',') : undefined,
        tags: currentTags.length > 0 ? currentTags.join(',') : undefined,
        sort: currentSort,
        q: currentSearch || undefined,
        type: currentTypes || undefined,
        status: currentStatuses || undefined,
        studio: currentStudio || undefined,
        season: currentSeason || undefined,
        year: currentYear || undefined,
        exclude_ids: currentExcludeIds || undefined,
        shelf: currentShelf || undefined,
        min_rating: currentMinRating || undefined,
        max_rating: currentMaxRating || undefined,
        source: currentSource || undefined,
        min_episodes: currentMinEpisodes || undefined,
        max_episodes: currentMaxEpisodes || undefined,
        min_duration: currentMinDuration || undefined,
        max_duration: currentMaxDuration || undefined,
        min_year: currentMinYear || undefined,
        max_year: currentMaxYear || undefined,
      }, signal).then(res => res.data),
    initialPageParam: 1,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousUnlessNewSearch(previousData, previousQuery, currentSearch),
    getNextPageParam: (lastPage) => {
      return getNextPageNumber(lastPage?.next);
    },
    staleTime: 1000 * 60 * 5,
    enabled: isGridMode,
  });

  // Flatten anime data
  const allAnime = useMemo(() =>
    data?.pages?.flatMap(page => page.results) || [],
    [data]
  );

  // Infinite scroll
  const observer = useRef(null);
  const prefetchTriggeredRef = useRef(false);

  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect();
        observer.current = null;
      }
    };
  }, []);

  const loadMoreRef = useCallback((node) => {
    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }

    if (isFetchingNextPage || !node) return;

    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();

          if (!prefetchTriggeredRef.current) {
            prefetchTriggeredRef.current = true;
            const nextPage = (data?.pages?.length || 0) + 2;
            prefetchNextPage({
              genres: currentGenres,
              tags: currentTags,
              sort: currentSort,
              search: currentSearch,
              type: currentTypes,
              status: currentStatuses,
              studio: currentStudio,
              season: currentSeason,
              year: currentYear,
              excludeIds: currentExcludeIds,
              shelf: currentShelf,
              minRating: currentMinRating,
              maxRating: currentMaxRating,
              source: currentSource,
              minEpisodes: currentMinEpisodes,
              maxEpisodes: currentMaxEpisodes,
              minDuration: currentMinDuration,
              maxDuration: currentMaxDuration,
              minYear: currentMinYear,
              maxYear: currentMaxYear,
              adultContentEnabled,
              pageSize: 12,
            }, nextPage);

            setTimeout(() => {
              prefetchTriggeredRef.current = false;
            }, 2000);
          }
        }
      },
      { threshold: 0.1, rootMargin: '300px' }
    );

    observer.current.observe(node);
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    data?.pages?.length,
    prefetchNextPage,
    currentGenres,
    currentTags,
    currentSort,
    currentSearch,
    currentTypes,
    currentStatuses,
    currentStudio,
    currentSeason,
    currentYear,
    currentExcludeIds,
    currentShelf,
    currentMinRating,
    currentMaxRating,
    currentSource,
    currentMinEpisodes,
    currentMaxEpisodes,
    currentMinDuration,
    currentMaxDuration,
    currentMinYear,
    currentMaxYear,
    adultContentEnabled,
  ]);

  return {
    allAnime,
    loadMoreRef,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  };
}
