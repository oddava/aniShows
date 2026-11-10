import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEBOUNCED_FILTER_KEYS, FILTER_UPDATE_DEBOUNCE_MS } from './browseFilterOptions';

/**
 * The Browse filters, read from and written to the URL. Also keeps a local
 * copy (`localFilters`) so range inputs update at once while their URL update
 * is debounced, and the helpers the filter bar, the advanced panel and the
 * active-filter chips call.
 */
export default function useBrowseUrlFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  const filterUpdateTimersRef = useRef({});

  // Parse URL params
  const currentGenres = useMemo(() =>
    searchParams.get('genre')?.split(',').filter(Boolean) || [],
    [searchParams]
  );
  const currentSort = searchParams.get('sort') || 'popular';
  const currentSearch = searchParams.get('q') || '';
  const currentTypes = searchParams.get('type') || '';
  const currentStatuses = searchParams.get('status') || '';
  const currentStudio = searchParams.get('studio') || '';
  const currentSeason = searchParams.get('season') || '';
  const currentYearParam = searchParams.get('year') || '';
  const currentYear = currentYearParam || (currentSeason ? new Date().getFullYear().toString() : '');
  const currentExcludeIds = searchParams.get('exclude_ids') || '';
  const currentShelf = searchParams.get('shelf') || '';
  const currentMinRating = searchParams.get('min_rating') || '';
  const currentMaxRating = searchParams.get('max_rating') || '';
  const currentSource = searchParams.get('source') || '';
  const currentMinEpisodes = searchParams.get('min_episodes') || '';
  const currentMaxEpisodes = searchParams.get('max_episodes') || '';
  const currentMinDuration = searchParams.get('min_duration') || '';
  const currentMaxDuration = searchParams.get('max_duration') || '';
  const currentMinYear = searchParams.get('min_year') || '';
  const currentMaxYear = searchParams.get('max_year') || '';
  const currentTags = useMemo(() =>
    searchParams.get('tags')?.split(',').filter(Boolean) || [],
    [searchParams]
  );

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [
    searchParams,
    currentGenres,
    currentMaxDuration,
    currentMaxEpisodes,
    currentMaxRating,
    currentMaxYear,
    currentMinDuration,
    currentMinEpisodes,
    currentMinRating,
    currentMinYear,
    currentSeason,
    currentSource,
    currentStatuses,
    currentStudio,
    currentTags,
    currentTypes,
    currentYear,
  ]);

  useEffect(() => () => {
    Object.values(filterUpdateTimersRef.current).forEach(clearTimeout);
    filterUpdateTimersRef.current = {};
  }, []);

  // Backward compatibility: seasonal filter requires year in API.
  // Auto-fill current year for legacy URLs like ?season=winter.
  useEffect(() => {
    if (!currentSeason || currentYearParam) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('year', new Date().getFullYear().toString());
    // Replace avoids polluting history while still normalizing shared seasonal URLs.
    setSearchParams(newParams, { replace: true });
  }, [currentSeason, currentYearParam, searchParams, setSearchParams]);

  const isGridMode = Boolean(
    currentSearch || 
    currentGenres.length > 0 || 
    currentTags.length > 0 ||
    currentTypes || 
    currentStatuses || 
    currentSeason || 
    currentYear || 
    currentMinRating || 
    currentMaxRating || 
    currentSource ||
    currentMinEpisodes ||
    currentMaxEpisodes ||
    currentMinDuration ||
    currentMaxDuration ||
    currentMinYear ||
    currentMaxYear ||
    currentStudio || 
    searchParams.has('sort')
  );

  // Local filter state
  const [localFilters, setLocalFilters] = useState({
    genres: currentGenres,
    type: currentTypes,
    status: currentStatuses,
    season: currentSeason,
    year: currentYear,
    minRating: currentMinRating,
    maxRating: currentMaxRating,
    studio: currentStudio,
    source: currentSource,
    minEpisodes: currentMinEpisodes,
    maxEpisodes: currentMaxEpisodes,
    minDuration: currentMinDuration,
    maxDuration: currentMaxDuration,
    minYear: currentMinYear,
    maxYear: currentMaxYear,
    tags: currentTags,
  });

  // Clear all filters function - defined early for useKeyboardShortcuts
  const clearAllFilters = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  // Sync local filters when URL params change
  useEffect(() => {
    setLocalFilters({
      genres: currentGenres,
      type: currentTypes,
      status: currentStatuses,
      season: currentSeason,
      year: currentYear,
      minRating: currentMinRating,
      maxRating: currentMaxRating,
      studio: currentStudio,
      source: currentSource,
      minEpisodes: currentMinEpisodes,
      maxEpisodes: currentMaxEpisodes,
      minDuration: currentMinDuration,
      maxDuration: currentMaxDuration,
      minYear: currentMinYear,
      maxYear: currentMaxYear,
      tags: currentTags,
    });
  }, [
    searchParams,
    currentGenres,
    currentMaxDuration,
    currentMaxEpisodes,
    currentMaxRating,
    currentMaxYear,
    currentMinDuration,
    currentMinEpisodes,
    currentMinRating,
    currentMinYear,
    currentSeason,
    currentSource,
    currentStatuses,
    currentStudio,
    currentTags,
    currentTypes,
    currentYear,
  ]);

  // Filter helpers
  const updateParam = useCallback((key, value) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('exclude_ids');
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const clearSeasonAndYear = useCallback(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('exclude_ids');
    newParams.delete('season');
    newParams.delete('year');
    newParams.delete('min_year');
    newParams.delete('max_year');
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const clearYearRange = useCallback(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('exclude_ids');
    newParams.delete('min_year');
    newParams.delete('max_year');
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const toggleArrayParam = useCallback((key, value) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('exclude_ids');
    const current = newParams.get(key)?.split(',').filter(Boolean) || [];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    if (updated.length > 0) {
      newParams.set(key, updated.join(','));
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const updateLocalFilter = useCallback((key, value) => {
    setLocalFilters(prev => ({ ...prev, [key]: value }));

    const keyMap = {
      type: 'type',
      status: 'status',
      season: 'season',
      year: 'year',
      minRating: 'min_rating',
      maxRating: 'max_rating',
      studio: 'studio',
      source: 'source',
      minEpisodes: 'min_episodes',
      maxEpisodes: 'max_episodes',
      minDuration: 'min_duration',
      maxDuration: 'max_duration',
      minYear: 'min_year',
      maxYear: 'max_year',
    };
    const paramKey = keyMap[key];
    if (!paramKey) return;

    const applyFilterParam = () => {
      const newParams = new URLSearchParams(searchParamsRef.current);
      newParams.delete('exclude_ids');
      if (value) {
        newParams.set(paramKey, value);
      } else {
        newParams.delete(paramKey);
      }

      if (key === 'year') {
        newParams.delete('min_year');
        newParams.delete('max_year');
      }
      if (key === 'minYear' || key === 'maxYear') {
        newParams.delete('year');
        newParams.delete('season');
      }
      if (DEBOUNCED_FILTER_KEYS.has(key)) {
        setSearchParams(newParams, { replace: true });
      } else {
        setSearchParams(newParams);
      }
    };

    if (DEBOUNCED_FILTER_KEYS.has(key)) {
      clearTimeout(filterUpdateTimersRef.current[key]);
      filterUpdateTimersRef.current[key] = setTimeout(() => {
        delete filterUpdateTimersRef.current[key];
        applyFilterParam();
      }, FILTER_UPDATE_DEBOUNCE_MS);
      return;
    }

    applyFilterParam();
  }, [setSearchParams]);

  const toggleLocalGenre = useCallback((genreSlug) => {
    const current = searchParams.get('genre')?.split(',').filter(Boolean) || [];
    const updated = current.includes(genreSlug)
      ? current.filter(g => g !== genreSlug)
      : [...current, genreSlug];

    setLocalFilters(prev => ({ ...prev, genres: updated }));

    const newParams = new URLSearchParams(searchParams);
    newParams.delete('exclude_ids');
    if (updated.length > 0) {
      newParams.set('genre', updated.join(','));
    } else {
      newParams.delete('genre');
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const toggleLocalTag = useCallback((tag) => {
    const current = searchParams.get('tags')?.split(',').filter(Boolean) || [];
    const normalized = tag.trim().toLowerCase();
    const updated = current.includes(normalized)
      ? current.filter(t => t !== normalized)
      : [...current, normalized];

    setLocalFilters(prev => ({ ...prev, tags: updated }));

    const newParams = new URLSearchParams(searchParams);
    newParams.delete('exclude_ids');
    if (updated.length > 0) {
      newParams.set('tags', updated.join(','));
    } else {
      newParams.delete('tags');
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const hasActiveFilters = Boolean(
    currentGenres.length > 0 ||
    currentTags.length > 0 ||
    currentTypes ||
    currentStatuses ||
    currentStudio ||
    currentSeason ||
    currentYear ||
    currentMinRating ||
    currentMaxRating ||
    currentSource ||
    currentMinEpisodes ||
    currentMaxEpisodes ||
    currentMinDuration ||
    currentMaxDuration ||
    currentMinYear ||
    currentMaxYear
  );

  return {
    searchParams,
    currentGenres,
    currentSort,
    currentSearch,
    currentTypes,
    currentStatuses,
    currentStudio,
    currentSeason,
    currentYearParam,
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
    currentTags,
    isGridMode,
    hasActiveFilters,
    localFilters,
    clearAllFilters,
    updateParam,
    clearSeasonAndYear,
    clearYearRange,
    toggleArrayParam,
    updateLocalFilter,
    toggleLocalGenre,
    toggleLocalTag,
  };
}
