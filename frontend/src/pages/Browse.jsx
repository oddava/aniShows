import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, X, Filter, TrendingUp, Play, Trophy, Clock, Sparkles, ArrowDownAZ, Users, Loader2 } from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AnimeCard from '../components/AnimeCard';
import AnimeListRow from '../components/browse/AnimeListRow';
import AnimeMinimalCard from '../components/browse/AnimeMinimalCard';
import { GridSkeleton, ListSkeleton, MinimalSkeleton } from '../components/skeletons';
import VirtualizedAnimeList from '../components/VirtualizedAnimeList';
import { LoadingBar } from '../components/LoadingBar';
import EmptyState from '../components/browse/EmptyState';
import ActiveFilterChips from '../components/browse/ActiveFilterChips';
import AdvancedFiltersPanel from '../components/browse/AdvancedFiltersPanel';
import ViewModeToggle from '../components/browse/ViewModeToggle';
import TrendingCarousel from '../components/browse/TrendingCarousel';
import { animeApi, genreApi, studioApi, authApi } from '../api/client';
import { getNextPageNumber } from '../api/pagination';
import { useAuth } from '../context/AuthContext';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import { usePrefetchAnime } from '../hooks/usePrefetchAnime';
import { useAnalytics } from '../hooks/useAnalytics';
import { usePerformanceMonitoring } from '../hooks/usePerformanceMonitoring';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import SEO from '../components/SEO';
import SakuraAnimation from '../components/SakuraAnimation';
import { useTheme } from '../context/ThemeContext';
import TopFilterBar from '../components/browse/TopFilterBar';
import BrowseRowMode from '../components/browse/BrowseRowMode';
import { filterBrowseGenres } from '../utils/realGenres';

const SORT_OPTIONS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'newest', label: 'Newest First' },
  { value: 'title', label: 'Title A-Z' },
];

const TYPE_OPTIONS = [
  { value: 'TV', label: 'TV Series' },
  { value: 'Movie', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'Special', label: 'Special' },
];

const STATUS_OPTIONS = [
  { value: 'Airing', label: 'Airing' },
  { value: 'Finished', label: 'Finished' },
  { value: 'Upcoming', label: 'Upcoming' },
];

const SEASON_OPTIONS = [
  { value: 'winter', label: 'Winter' },
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
];

const YEAR_OPTIONS = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);
const MIN_YEAR_BOUND = 1980;
const MAX_YEAR_BOUND = new Date().getFullYear() + 1;
const FILTER_UPDATE_DEBOUNCE_MS = 250;
const DEBOUNCED_FILTER_KEYS = new Set([
  'minRating',
  'maxRating',
  'minEpisodes',
  'maxEpisodes',
  'minDuration',
  'maxDuration',
  'minYear',
  'maxYear',
]);

const SOURCE_OPTIONS = [
  { value: 'Original', label: 'Original' },
  { value: 'Manga', label: 'Manga' },
  { value: 'Light Novel', label: 'Light Novel' },
  { value: 'Visual Novel', label: 'Visual Novel' },
  { value: 'Game', label: 'Game' },
  { value: 'Web Manga', label: 'Web Manga' },
  { value: 'Novel', label: 'Novel' },
  { value: 'Music', label: 'Music' },
  { value: 'Mixed Media', label: 'Mixed Media' },
  { value: 'Picture Book', label: 'Picture Book' },
  { value: 'Card Game', label: 'Card Game' },
  { value: 'Other', label: 'Other' },
];

const ADVANCED_TAG_GROUPS = [
  {
    title: 'Cast / Main Cast',
    tags: [
      'anti-hero',
      'ensemble cast',
      'female protagonist',
      'male protagonist',
      'primarily adult cast',
      'primarily teen cast',
    ],
  },
  {
    title: 'Theme / Fantasy',
    tags: [
      'isekai',
      'magic',
      'mythology',
      'super power',
      'youkai',
      'witch',
    ],
  },
  {
    title: 'Theme / Sci Fi',
    tags: [
      'cyberpunk',
      'space opera',
      'time loop',
      'time manipulation',
      'post-apocalyptic',
      'virtual world',
    ],
  },
  {
    title: 'Theme / Action',
    tags: ['martial arts', 'swordplay', 'guns', 'battle royale', 'espionage', 'samurai'],
  },
  {
    title: 'Theme / Drama',
    tags: ['revenge', 'coming of age', 'conspiracy', 'tragedy', 'war', 'class struggle'],
  },
];



export default function Browse() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef(null);
  const searchParamsRef = useRef(searchParams);
  const filterUpdateTimersRef = useRef({});

  // State
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('browse_view_mode') || 'grid');
  const [titleLanguage, setTitleLanguage] = useState(() => localStorage.getItem('title_language') || 'en');
  const [activeTab, setActiveTab] = useState('popular');
  const [isTabSwitching, setIsTabSwitching] = useState(false);
  const [minLoadingTime, setMinLoadingTime] = useState(false);

  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const saved = localStorage.getItem('browse_collapsed_sections');
      return saved ? JSON.parse(saved) : { genres: false };
    } catch {
      return { genres: false };
    }
  });

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

  // Hooks
  const queryClient = useQueryClient();
  const { isAuthenticated, user, refreshProfile } = useAuth();
  const adultContentEnabled = Boolean(user?.show_adult_content);
  const [isUpdatingAdultContent, setIsUpdatingAdultContent] = useState(false);
  const skeletonCount = useSkeletonCount(viewMode);
  const { prefetchNextPage } = usePrefetchAnime();
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
        queryClient.setQueryData(['ownProfile'], updatedProfile);
      } else {
        await refreshProfile();
      }
      queryClient.removeQueries({ queryKey: ['anime'] });
      queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
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
    queryKey: ['genres'],
    queryFn: () => genreApi.getAll().then(res => res.data),
    staleTime: 1000 * 60 * 30,
  });
  const browseGenres = useMemo(() => filterBrowseGenres(genres), [genres]);

  // Fetch studios
  const { data: studios, isError: isStudiosError } = useQuery({
    queryKey: ['studios'],
    queryFn: () => studioApi.getAll().then(res => res.data),
    staleTime: 1000 * 60 * 30,
    enabled: shouldLoadStudios,
  });

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
    queryKey: [
      'anime',
      'list',
      currentGenres.join(','),
      currentTags.join(','),
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
    ],
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

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('browse_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('title_language', titleLanguage);
  }, [titleLanguage]);

  // Hero fetching removed since it's handled by BrowseRowMode

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

  useEffect(() => {
    document.title = 'Browse Anime - AniShows';
  }, []);

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

  const toggleSection = useCallback((section) => {
    const newCollapsed = { ...collapsedSections, [section]: !collapsedSections[section] };
    setCollapsedSections(newCollapsed);
    localStorage.setItem('browse_collapsed_sections', JSON.stringify(newCollapsed));
  }, [collapsedSections]);

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
                {isGridMode ? renderContent() : <BrowseRowMode titleLanguage={titleLanguage} />}
              </div>
            </main>
          </div>
        </div>
      </div>


    </>
  );

  function renderContent() {
    const errorState = (
      <div className="text-center py-16">
        <p className="text-red-400 mb-4">Failed to load anime</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={() => refetch()} className="btn-primary">
            Try Again
          </button>
          <button onClick={() => window.location.reload()} className="btn-secondary">
            Reload Page
          </button>
        </div>
      </div>
    );

    // Grid View
    if (viewMode === 'grid') {
      return (
        <div>
          {isError ? (
            errorState
          ) : isLoading || isTabSwitching ? (
            <div className="skeleton-fade-in">
              <GridSkeleton count={skeletonCount} />
              <div ref={loadMoreRef} className="h-0 overflow-hidden" />
            </div>
          ) : allAnime.length === 0 ? (
            <EmptyState
              onClearFilters={clearAllFilters}
              hasActiveFilters={hasActiveFilters || currentSearch !== ''}
              searchQuery={currentSearch}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 anime-card-grid-gap">
                {allAnime.map((anime, index) => (
                    <AnimeCard
                      key={anime.id}
                      anime={anime}
                      titleLanguage={titleLanguage}
                      rank={currentSort === 'rating' ? (index + 1) : null}
                      priority={index < 6}
                      index={index}
                    />
                  ))}
              </div>
              <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
                {isFetchingNextPage && (
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                )}
              </div>
            </>
          )}
        </div>
      );
    }

    // List View
    if (viewMode === 'list') {
      return (
        <div className="space-y-3">
          {isError ? (
            errorState
          ) : isLoading || isTabSwitching ? (
            <div className="skeleton-fade-in">
              <ListSkeleton count={skeletonCount} />
              <div ref={loadMoreRef} className="h-0 overflow-hidden" />
            </div>
          ) : allAnime.length === 0 ? (
            <EmptyState
              onClearFilters={clearAllFilters}
              hasActiveFilters={hasActiveFilters || currentSearch !== ''}
              searchQuery={currentSearch}
            />
          ) : allAnime.length > 20 ? (
            <>
              <VirtualizedAnimeList
                items={allAnime}
                renderRow={(anime) => (
                  <AnimeListRow anime={anime} titleLanguage={titleLanguage} />
                )}
                estimateSize={140}
                overscan={5}
              />
              <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
                {isFetchingNextPage && (
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                )}
              </div>
            </>
          ) : (
            <>
              {allAnime.map((anime) => (
                <AnimeListRow key={anime.id} anime={anime} titleLanguage={titleLanguage} />
              ))}
              <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
                {isFetchingNextPage && (
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                )}
              </div>
            </>
          )}
        </div>
      );
    }

    // Minimal View
    return (
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-8 xl:grid-cols-10 gap-2">
        {isError ? (
          <div className="col-span-full">{errorState}</div>
        ) : isLoading || isTabSwitching ? (
          <div className="col-span-full grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-8 xl:grid-cols-10 gap-2 skeleton-fade-in">
            <MinimalSkeleton count={skeletonCount} />
            <div ref={loadMoreRef} className="col-span-full h-0 overflow-hidden" />
          </div>
        ) : allAnime.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              onClearFilters={clearAllFilters}
              hasActiveFilters={hasActiveFilters || currentSearch !== ''}
              searchQuery={currentSearch}
            />
          </div>
        ) : (
          <>
            {allAnime.map((anime) => (
              <AnimeMinimalCard key={anime.id} anime={anime} titleLanguage={titleLanguage} />
            ))}
            <div ref={loadMoreRef} className="col-span-full h-10 flex justify-center items-center py-8">
              {isFetchingNextPage && (
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
              )}
            </div>
          </>
        )}
      </div>
    );
  }
}
