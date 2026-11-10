import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LoadingBar } from '../components/LoadingBar';
import ActiveFilterChips from '../components/browse/ActiveFilterChips';
import AdvancedFiltersPanel from '../components/browse/AdvancedFiltersPanel';
import ViewModeToggle from '../components/browse/ViewModeToggle';
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

export default function Browse() {
  const searchInputRef = useRef(null);

  // State
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('browse_view_mode') || 'grid');
  const [titleLanguage, setTitleLanguage] = useState(() => localStorage.getItem('title_language') || 'en');
  const [activeTab, setActiveTab] = useState('popular');

  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const saved = localStorage.getItem('browse_collapsed_sections');
      return saved ? JSON.parse(saved) : { genres: false };
    } catch {
      return { genres: false };
    }
  });

  // Filters live in the URL
  const filters = useBrowseUrlFilters();
  const {
    searchParams,
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
    updateParam,
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

  // Track analytics
  useEffect(() => {
    if (activeTab) trackTabChange(activeTab);
  }, [activeTab, trackTabChange]);

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

  // Update active tab based on params
  useEffect(() => {
    if (currentSort === 'trending') setActiveTab('trending');
    else if (currentSeason && currentYear) {
      const d = new Date();
      const m = d.getMonth();
      const y = d.getFullYear();
      let thisSeason = 'winter';
      if (m >= 3 && m <= 5) thisSeason = 'spring';
      else if (m >= 6 && m <= 8) thisSeason = 'summer';
      else if (m >= 9 && m <= 11) thisSeason = 'fall';

      if (currentSeason === thisSeason && parseInt(currentYear, 10) === y) {
        setActiveTab('current');
      } else {
        setActiveTab('upcoming');
      }
    }
    else if (currentSort === 'rating') setActiveTab('top');
    else if (currentSort === 'newest') setActiveTab('newest');
    else if (currentSort === 'title') setActiveTab('title');
    else if (currentSearch && !searchParams.get('sort') && !currentSeason) setActiveTab('search');
    else if (currentSort === 'popular') setActiveTab('popular');
    else setActiveTab(null);
  }, [currentSort, currentSeason, currentYear, currentSearch, searchParams]);

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
    refetch,
    isTabSwitching,
  } = useBrowseAnimeList({ filters, adultContentEnabled });

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('browse_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('title_language', titleLanguage);
  }, [titleLanguage]);

  useEffect(() => {
    document.title = 'Browse Anime - AniShows';
  }, []);

  const toggleSection = useCallback((section) => {
    const newCollapsed = { ...collapsedSections, [section]: !collapsedSections[section] };
    setCollapsedSections(newCollapsed);
    localStorage.setItem('browse_collapsed_sections', JSON.stringify(newCollapsed));
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
      <LoadingBar isLoading={isLoading || isFetching || isTabSwitching} />
      {theme === 'retro-anime' && <SakuraAnimation />}

      <div className="pt-4 pb-0 sm:py-8 px-3 sm:px-4 lg:px-6">
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
                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                      <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />

                      {/* Title Language Toggle */}
                      <button
                        onClick={() => setTitleLanguage(titleLanguage === 'en' ? 'jp' : 'en')}
                        className="flex items-center justify-center px-3 h-9 bg-dark-100 border border-gray-700 rounded-lg text-[11px] font-bold text-gray-300 hover:border-accent transition-colors"
                        title="Toggle title language"
                      >
                        {titleLanguage === 'en' ? 'EN' : 'JP'}
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
                    isLoading={isLoading}
                    isTabSwitching={isTabSwitching}
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
