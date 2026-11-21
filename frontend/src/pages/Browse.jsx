import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { LoadingBar } from '../components/LoadingBar';
import ActiveFilterChips from '../components/browse/ActiveFilterChips';
import AdvancedFiltersPanel from '../components/browse/AdvancedFiltersPanel';
import ViewModeToggle from '../components/browse/ViewModeToggle';
import SortSelect from '../components/browse/SortSelect';
import BrowseResults from '../components/browse/BrowseResults';
import useBrowseUrlFilters from '../components/browse/useBrowseUrlFilters';
import useBrowseAnimeList from '../components/browse/useBrowseAnimeList';
import {
  ADVANCED_TAG_GROUPS,
  MAX_YEAR_BOUND,
  MIN_YEAR_BOUND,
  SEASON_OPTIONS,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  YEAR_OPTIONS,
  formatSeasonLabel,
  SORT_OPTIONS,
} from '../components/browse/browseFilterOptions';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import { useAnalytics } from '../hooks/useAnalytics';
import { usePerformanceMonitoring } from '../hooks/usePerformanceMonitoring';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import SEO from '../components/SEO';
import SakuraAnimation from '../components/SakuraAnimation';
import { useTheme } from '../context/ThemeContext';
import TopFilterBar from '../components/browse/TopFilterBar';
import BrowseRowMode from '../components/browse/BrowseRowMode';
import { filterBrowseGenres } from '../utils/realGenres';
import { animeKeys, genreQueries, studioQueries } from '../api/queries/anime';
import { profileKeys } from '../api/queries/user';

// localStorage can throw (private mode, blocked storage); these preferences
// are conveniences, so a failure only means the default is used.
const readStored = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
};

export default function Browse() {
  const searchInputRef = useRef(null);
  const location = useLocation();

  // Arriving from the mobile top bar's search button: put the cursor in the box.
  useEffect(() => {
    if (location.state?.focusSearch) {
      searchInputRef.current?.focus();
    }
  }, [location.key, location.state]);

  // State
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState(() => readStored('browse_view_mode', 'grid'));
  const [titleLanguage, setTitleLanguage] = useState(() => readStored('title_language', 'en'));

  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const saved = readStored('browse_collapsed_sections', null);
      return saved ? JSON.parse(saved) : { genres: false };
    } catch {
      return { genres: false };
    }
  });

  // Filters live in the URL
  const filters = useBrowseUrlFilters();
  const {
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
    searchWithoutFilters,
    updateParam,
    setSort,
    stepSeason,
    clearSeasonAndYear,
    clearYearRange,
    toggleArrayParam,
    updateLocalFilter,
    toggleLocalGenre,
    toggleLocalTag,
  } = filters;

  // Hooks
  const queryClient = useQueryClient();
  const { isAuthenticated, user, refreshProfile } = useAuth();
  const adultContentEnabled = Boolean(user?.show_adult_content);
  const [isUpdatingAdultContent, setIsUpdatingAdultContent] = useState(false);
  const skeletonCount = useSkeletonCount(viewMode);
  const { trackTabChange, trackViewModeChange, trackSearch } = useAnalytics();
  const { theme } = useTheme();
  usePerformanceMonitoring('Browse');

  // Keyboard shortcuts
  useKeyboardShortcuts({
    enabled: true,
    onSearchFocus: () => searchInputRef.current?.focus(),
    onGridView: () => setViewMode('grid'),
    onListView: () => setViewMode('list'),
    onMinimalView: () => setViewMode('minimal'),
    onToggleFilters: () => setShowFilters(prev => !prev),
    onClearFilters: clearAllFilters,
    onEscape: () => {
      if (showFilters) setShowFilters(false);
    }
  });

  // Track analytics (the sort is what the old "tab" event described)
  useEffect(() => {
    trackTabChange(currentSort);
  }, [currentSort, trackTabChange]);

  useEffect(() => {
    trackViewModeChange(viewMode);
  }, [viewMode, trackViewModeChange]);

  useEffect(() => {
    if (currentSearch) trackSearch(currentSearch);
  }, [currentSearch, trackSearch]);

  const handleToggleAdultContent = useCallback(async () => {
    if (!isAuthenticated || isUpdatingAdultContent) return;

    const nextValue = !adultContentEnabled;
    setIsUpdatingAdultContent(true);
    try {
      const response = await authApi.updateProfile({ show_adult_content: nextValue });
      const updatedProfile = response?.data;
      if (updatedProfile && typeof updatedProfile === 'object') {
        await refreshProfile(updatedProfile);
        queryClient.setQueryData(profileKeys.own, updatedProfile);
      } else {
        await refreshProfile();
      }
      queryClient.removeQueries({ queryKey: animeKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.own });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    } finally {
      setIsUpdatingAdultContent(false);
    }
  }, [
    adultContentEnabled,
    isAuthenticated,
    isUpdatingAdultContent,
    queryClient,
    refreshProfile,
  ]);

  // "Fall 2026" heads the grid while a season is selected (P2-7).
  const seasonLabel = formatSeasonLabel(currentSeason, currentYear);

  const shouldLoadStudios = showFilters || Boolean(currentStudio);

  // Fetch genres
  const { data: genres, isError: isGenresError } = useQuery({
    ...genreQueries.all(),
    staleTime: 1000 * 60 * 30,
  });
  const browseGenres = useMemo(() => filterBrowseGenres(genres), [genres]);

  // Fetch studios
  const { data: studios, isError: isStudiosError } = useQuery({
    ...studioQueries.all(),
    staleTime: 1000 * 60 * 30,
    enabled: shouldLoadStudios,
  });

  // Fetch anime
  const {
    allAnime,
    loadMoreRef,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  } = useBrowseAnimeList({ filters, adultContentEnabled });

  // Persist view mode
  useEffect(() => {
    writeStored('browse_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    writeStored('title_language', titleLanguage);
  }, [titleLanguage]);

  const toggleSection = useCallback((section) => {
    const newCollapsed = { ...collapsedSections, [section]: !collapsedSections[section] };
    setCollapsedSections(newCollapsed);
    writeStored('browse_collapsed_sections', JSON.stringify(newCollapsed));
  }, [collapsedSections]);

  // Filter sidebar props
  const filterSidebarProps = {
    genres: browseGenres,
    studios,
    isGenresError,
    isStudiosError,
    localFilters,
    collapsedSections,
    onToggleSection: toggleSection,
    onUpdateFilter: updateLocalFilter,
    onToggleGenre: toggleLocalGenre,
    onToggleTag: toggleLocalTag,
    typeOptions: TYPE_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    seasonOptions: SEASON_OPTIONS,
    yearOptions: YEAR_OPTIONS,
    sourceOptions: SOURCE_OPTIONS,
    tagGroups: ADVANCED_TAG_GROUPS,
    minYearBound: MIN_YEAR_BOUND,
    maxYearBound: MAX_YEAR_BOUND,
  };

  return (
    <>
      <SEO page="browse" />
      <LoadingBar isLoading={isLoading || isFetching} />
      {theme === 'retro-anime' && <SakuraAnimation />}

      <div className="pt-4 pb-0 sm:py-8 px-4 md:px-6">
        <div className="max-w-[1600px] mx-auto">


          {/* Main Layout */}
          <div className="w-full">
            {/* Main Content */}
            <main className="flex-1 min-w-0">

              <div className="max-w-7xl mx-auto w-full">
                <TopFilterBar
                  genres={browseGenres}
                  isGenresError={isGenresError}
                  typeOptions={TYPE_OPTIONS}
                  statusOptions={STATUS_OPTIONS}
                  seasonOptions={SEASON_OPTIONS}
                  yearOptions={YEAR_OPTIONS}
                  searchInputRef={searchInputRef}
                  onOpenMobileFilters={() => setShowFilters(!showFilters)}
                  hasActiveFilters={hasActiveFilters}
                  adultContentEnabled={adultContentEnabled}
                  onToggleAdultContent={handleToggleAdultContent}
                  isUpdatingAdultContent={isUpdatingAdultContent}
                  canToggleAdultContent={isAuthenticated}
                />

                <AdvancedFiltersPanel
                  isOpen={showFilters}
                  onClose={() => setShowFilters(false)}
                  {...filterSidebarProps}
                />

                {/* Controls Bar - only show view controls in grid mode */}
                {isGridMode && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    {seasonLabel ? (
                      <h1 className="page-title">{seasonLabel}</h1>
                    ) : (
                      <h1 className="section-title hidden sm:block">
                        {currentSearch
                          ? `Results for “${currentSearch}”`
                          : SORT_OPTIONS.find((option) => option.value === currentSort)?.label || 'Browse'}
                      </h1>
                    )}
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:gap-3 w-full sm:w-auto sm:ml-auto">
                      <SortSelect value={currentSort} hasSearch={Boolean(currentSearch)} onChange={setSort} />
                      <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />

                      {/* Title Language Toggle */}
                      <button
                        onClick={() => setTitleLanguage(titleLanguage === 'en' ? 'jp' : 'en')}
                        className="flex h-11 items-center justify-center rounded-lg bg-white/[0.04] px-3 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
                        type="button"
                        title="Toggle title language"
                        aria-label={`Title language: ${titleLanguage === 'en' ? 'English' : 'Japanese'}. Switch`}
                      >
                        <span className="mr-1 hidden xs:inline">Titles:</span>
                        <span className="text-[var(--text-1)]">{titleLanguage === 'en' ? 'English' : 'Japanese'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Filter Chips */}
                <ActiveFilterChips
                  currentTypes={currentTypes}
                  currentStatuses={currentStatuses}
                  currentSeason={currentSeason}
                  currentYear={currentYear}
                  currentMinRating={currentMinRating}
                  currentMaxRating={currentMaxRating}
                  currentStudio={currentStudio}
                  currentGenres={currentGenres}
                  currentTags={currentTags}
                  currentSource={currentSource}
                  currentMinEpisodes={currentMinEpisodes}
                  currentMaxEpisodes={currentMaxEpisodes}
                  currentMinDuration={currentMinDuration}
                  currentMaxDuration={currentMaxDuration}
                  currentMinYear={currentMinYear}
                  currentMaxYear={currentMaxYear}
                  typeOptions={TYPE_OPTIONS}
                  statusOptions={STATUS_OPTIONS}
                  seasonOptions={SEASON_OPTIONS}
                  sourceOptions={SOURCE_OPTIONS}
                  studios={studios}
                  genres={genres}
                  onClearType={() => updateParam('type', '')}
                  onClearStatus={() => updateParam('status', '')}
                  onClearSeason={clearSeasonAndYear}
                  onStepSeason={stepSeason}
                  onClearYear={() => updateParam('year', '')}
                  onClearMinRating={() => updateParam('min_rating', '')}
                  onClearMaxRating={() => updateParam('max_rating', '')}
                  onClearStudio={() => updateParam('studio', '')}
                  onToggleGenre={(genre) => toggleArrayParam('genre', genre)}
                  onToggleTag={(tag) => toggleArrayParam('tags', tag)}
                  onClearSource={() => updateParam('source', '')}
                  onClearMinEpisodes={() => updateParam('min_episodes', '')}
                  onClearMaxEpisodes={() => updateParam('max_episodes', '')}
                  onClearMinDuration={() => updateParam('min_duration', '')}
                  onClearMaxDuration={() => updateParam('max_duration', '')}
                  onClearYearRange={clearYearRange}
                  onClearAll={clearAllFilters}
                  hasActiveFilters={hasActiveFilters}
                />

                {/* Anime Content */}
                {isGridMode ? (
                  <BrowseResults
                    viewMode={viewMode}
                    allAnime={allAnime}
                    titleLanguage={titleLanguage}
                    currentSort={currentSort}
                    currentSearch={currentSearch}
                    hasActiveFilters={hasActiveFilters}
                    clearAllFilters={clearAllFilters}
                    searchWithoutFilters={searchWithoutFilters}
                    isLoading={isLoading}
                    isStale={isPlaceholderData}
                    isError={isError}
                    isFetchingNextPage={isFetchingNextPage}
                    refetch={refetch}
                    skeletonCount={skeletonCount}
                    loadMoreRef={loadMoreRef}
                  />
                ) : <BrowseRowMode titleLanguage={titleLanguage} />}
              </div>
            </main>
          </div>
        </div>
      </div>


    </>
  );
}
