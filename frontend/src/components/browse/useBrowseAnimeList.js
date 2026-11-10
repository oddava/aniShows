import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { animeApi } from '../../api/client';
import { getNextPageNumber } from '../../api/pagination';
import { animeKeys } from '../../api/queries/anime';
import { usePrefetchAnime } from '../../hooks/usePrefetchAnime';

/**
 * The Browse result list for the current URL filters: an infinite query (only
 * in grid mode, i.e. when a filter or sort is set), the next-page sentinel
 * (`loadMoreRef`) with its prefetch, and the tab-switch loading guard.
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
  const [isTabSwitching, setIsTabSwitching] = useState(false);
  const [minLoadingTime, setMinLoadingTime] = useState(false);
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
    placeholderData: (previousData) => previousData,
    getNextPageParam: (lastPage) => {
      return getNextPageNumber(lastPage?.next);
    },
    staleTime: 1000 * 60 * 5,
    enabled: isGridMode,
  });

  // Reset tab switching state
  useEffect(() => {
    if (!isLoading && data && minLoadingTime) {
      setIsTabSwitching(false);
      setMinLoadingTime(false);
    }
    if (isError) {
      setIsTabSwitching(false);
      setMinLoadingTime(false);
    }
  }, [isLoading, data, minLoadingTime, isError]);

  useEffect(() => {
    let isMounted = true;
    if (isTabSwitching) {
      setMinLoadingTime(false);
      const timer = setTimeout(() => {
        if (isMounted) setMinLoadingTime(true);
      }, 500);

      // Safety valve: never keep loading UI locked forever.
      const maxTimer = setTimeout(() => {
        if (isMounted) {
          setIsTabSwitching(false);
          setMinLoadingTime(false);
        }
      }, 6000);

      return () => {
        isMounted = false;
        clearTimeout(timer);
        clearTimeout(maxTimer);
      };
    }
  }, [isTabSwitching]);

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

    if (isTabSwitching || isFetchingNextPage || !node) return;

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
    isTabSwitching,
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
    refetch,
    isTabSwitching,
  };
}
