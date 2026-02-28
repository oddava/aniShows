import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
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
import FilterSidebar from '../components/browse/FilterSidebar';
import ViewModeToggle from '../components/browse/ViewModeToggle';
import TrendingCarousel from '../components/browse/TrendingCarousel';
import MobileFilterDrawer from '../components/browse/MobileFilterDrawer';
import { animeApi, genreApi, studioApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import { usePrefetchAnime } from '../hooks/usePrefetchAnime';
import { useAnalytics } from '../hooks/useAnalytics';
import { usePerformanceMonitoring } from '../hooks/usePerformanceMonitoring';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import SEO from '../components/SEO';

const BROWSE_TABS = [
  { key: 'popular', label: 'Most Popular', icon: Users },
  { key: 'current', label: 'This Season', icon: Play },
  { key: 'upcoming', label: 'Upcoming', icon: Clock },
  { key: 'top', label: 'All Time Best', icon: Trophy },
  { key: 'newest', label: 'Newest', icon: Sparkles },
  { key: 'title', label: 'A-Z', icon: ArrowDownAZ },
];

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

const QUICK_FILTER_GENRES = ['action', 'romance', 'comedy', 'fantasy', 'drama', 'sci-fi'];

export default function Browse() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef(null);

  // State
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('browse_view_mode') || 'grid');
  const [titleLanguage, setTitleLanguage] = useState(() => localStorage.getItem('title_language') || 'en');
  const [activeTab, setActiveTab] = useState('popular');
  const [isTabSwitching, setIsTabSwitching] = useState(false);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);
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
  const currentMinRating = searchParams.get('min_rating') || '';
  const currentMaxRating = searchParams.get('max_rating') || '';

  // Local filter state
  const [localFilters, setLocalFilters] = useState({
    genres: currentGenres,
    type: currentTypes,
    status: currentStatuses,
    season: currentSeason,
    year: currentYearParam,
    minRating: currentMinRating,
    maxRating: currentMaxRating,
    studio: currentStudio,
  });

  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);

  // Clear all filters function - defined early for useKeyboardShortcuts
  const clearAllFilters = useCallback(() => {
    setSearchParams({});
    setSearchInput('');
  }, [setSearchParams]);

  // Hooks
  const { isAuthenticated } = useAuth();
  const skeletonCount = useSkeletonCount(viewMode);
  const { prefetchNextPage } = usePrefetchAnime();
  const { trackTabChange, trackViewModeChange, trackSearch } = useAnalytics();
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

  // Sync local filters when URL params change
  useEffect(() => {
    setLocalFilters({
      genres: currentGenres,
      type: currentTypes,
      status: currentStatuses,
      season: currentSeason,
      year: currentYearParam,
      minRating: currentMinRating,
      maxRating: currentMaxRating,
      studio: currentStudio,
    });
    setHasUnappliedChanges(false);
  }, [searchParams]);

  // Check for unapplied changes
  useEffect(() => {
    const hasChanges =
      JSON.stringify(localFilters.genres.sort()) !== JSON.stringify(currentGenres.sort()) ||
      localFilters.type !== currentTypes ||
      localFilters.status !== currentStatuses ||
      localFilters.season !== currentSeason ||
      localFilters.year !== currentYearParam ||
      localFilters.minRating !== currentMinRating ||
      localFilters.maxRating !== currentMaxRating ||
      localFilters.studio !== currentStudio;
    setHasUnappliedChanges(hasChanges);
  }, [localFilters, currentGenres, currentTypes, currentStatuses, currentSeason, currentYearParam, currentMinRating, currentMaxRating, currentStudio]);

  // Apply filters to URL
  const applyFilters = useCallback(() => {
    const newParams = new URLSearchParams(searchParams);

    if (localFilters.genres.length > 0) {
      newParams.set('genre', localFilters.genres.join(','));
    } else {
      newParams.delete('genre');
    }

    ['type', 'status', 'season', 'year', 'min_rating', 'max_rating', 'studio'].forEach(key => {
      const value = localFilters[key === 'min_rating' ? 'minRating' : key === 'max_rating' ? 'maxRating' : key];
      if (value) {
        newParams.set(key, value);
      } else {
        newParams.delete(key);
      }
    });

    setSearchParams(newParams);
  }, [localFilters, searchParams, setSearchParams]);

  const resetFilters = useCallback(() => {
    setLocalFilters({
      genres: currentGenres,
      type: currentTypes,
      status: currentStatuses,
      season: currentSeason,
      year: currentYearParam,
      minRating: currentMinRating,
      maxRating: currentMaxRating,
      studio: currentStudio,
    });
  }, [currentGenres, currentTypes, currentStatuses, currentSeason, currentYearParam, currentMinRating, currentMaxRating, currentStudio]);

  const handleApplyMobile = useCallback(() => {
    setIsApplyingFilters(true);
    applyFilters();
    setTimeout(() => {
      setIsApplyingFilters(false);
      setShowFilters(false);
    }, 500);
  }, [applyFilters]);

  // Update active tab based on params
  useEffect(() => {
    if (currentSort === 'trending') setActiveTab('trending');
    else if (currentSeason && currentYearParam) {
      const d = new Date();
      const m = d.getMonth();
      const y = d.getFullYear();
      let thisSeason = 'winter';
      if (m >= 3 && m <= 5) thisSeason = 'spring';
      else if (m >= 6 && m <= 8) thisSeason = 'summer';
      else if (m >= 9 && m <= 11) thisSeason = 'fall';

      if (currentSeason === thisSeason && parseInt(currentYearParam) === y) {
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
  }, [currentSort, currentSeason, currentYearParam, currentSearch, searchParams]);

  const handleTabChange = useCallback((key) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('sort');
    newParams.delete('status');
    newParams.delete('season');
    newParams.delete('year');

    const d = new Date();
    const month = d.getMonth();
    const year = d.getFullYear();

    switch (key) {
      case 'trending':
        newParams.set('sort', 'trending');
        break;
      case 'current': {
        let season = 'winter';
        if (month >= 3 && month <= 5) season = 'spring';
        else if (month >= 6 && month <= 8) season = 'summer';
        else if (month >= 9 && month <= 11) season = 'fall';

        newParams.set('season', season);
        newParams.set('year', year.toString());
        newParams.set('sort', 'popular');
        break;
      }
      case 'upcoming': {
        let nextSeason = 'winter';
        let nextYear = year;

        if (month >= 0 && month <= 2) { nextSeason = 'spring'; }
        else if (month >= 3 && month <= 5) { nextSeason = 'summer'; }
        else if (month >= 6 && month <= 8) { nextSeason = 'fall'; }
        else { nextSeason = 'winter'; nextYear = year + 1; }

        newParams.set('season', nextSeason);
        newParams.set('year', nextYear.toString());
        newParams.set('sort', 'popular');
        break;
      }
      case 'top':
        newParams.set('sort', 'rating');
        break;
      case 'popular':
        newParams.set('sort', 'popular');
        break;
      case 'newest':
        newParams.set('sort', 'newest');
        break;
      case 'title':
        newParams.set('sort', 'title');
        break;
    }

    setActiveTab(key);
    setIsTabSwitching(true);
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  // Fetch genres
  const { data: genres, isError: isGenresError } = useQuery({
    queryKey: ['genres'],
    queryFn: () => genreApi.getAll().then(res => res.data),
    staleTime: 1000 * 60 * 30,
  });

  // Fetch studios
  const { data: studios, isError: isStudiosError } = useQuery({
    queryKey: ['studios'],
    queryFn: () => studioApi.getAll().then(res => res.data),
    staleTime: 1000 * 60 * 30,
  });

  // Fetch anime
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['anime', 'list', currentGenres.join(','), currentSort, currentSearch, currentTypes, currentStatuses, currentStudio, currentSeason, currentYearParam, currentMinRating, currentMaxRating],
    queryFn: ({ pageParam }) =>
      animeApi.getAll({
        page: pageParam,
        page_size: 12,
        genre: currentGenres.length > 0 ? currentGenres.join(',') : undefined,
        sort: currentSort,
        q: currentSearch || undefined,
        type: currentTypes || undefined,
        status: currentStatuses || undefined,
        studio: currentStudio || undefined,
        season: currentSeason || undefined,
        year: currentYearParam || undefined,
        min_rating: currentMinRating || undefined,
        max_rating: currentMaxRating || undefined,
      }).then(res => res.data),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage && lastPage.next) {
        const url = new URL(lastPage.next);
        return url.searchParams.get('page');
      }
      return undefined;
    },
    staleTime: 1000 * 60 * 5,
  });

  // Reset tab switching state
  useEffect(() => {
    if (!isLoading && data && minLoadingTime) {
      setIsTabSwitching(false);
      setMinLoadingTime(false);
    }
  }, [isLoading, data, minLoadingTime]);

  useEffect(() => {
    let isMounted = true;
    if (isTabSwitching) {
      setMinLoadingTime(false);
      const timer = setTimeout(() => {
        if (isMounted) setMinLoadingTime(true);
      }, 500);
      return () => { isMounted = false; clearTimeout(timer); };
    }
  }, [isTabSwitching]);

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('browse_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('title_language', titleLanguage);
  }, [titleLanguage]);

  // Fetch trending anime
  const { data: trendingHero, isError: isHeroError } = useQuery({
    queryKey: ['anime', 'hero-trending'],
    queryFn: () => animeApi.getTrending().then(res => res.data),
    staleTime: 1000 * 60 * 30,
  });

  const showHero = activeTab === 'popular' && !currentSearch && !currentGenres.length;

  // Flatten anime data
  const allAnime = useMemo(() =>
    data?.pages?.flatMap(page => page.results) || [],
    [data]
  );
  const totalCount = data?.pages?.[0]?.count || 0;

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
              sort: currentSort,
              search: currentSearch,
              type: currentTypes,
              status: currentStatuses,
              studio: currentStudio,
              season: currentSeason,
              year: currentYearParam,
              minRating: currentMinRating,
              maxRating: currentMaxRating,
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
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isTabSwitching, data?.pages?.length, prefetchNextPage, currentGenres, currentSort, currentSearch, currentTypes, currentStatuses, currentStudio, currentSeason, currentYearParam, currentMinRating, currentMaxRating]);

  // Search debounce
  useEffect(() => {
    let isMounted = true;
    const timeout = setTimeout(() => {
      if (isMounted && searchInput !== currentSearch) {
        const newParams = new URLSearchParams(searchParams);
        if (searchInput) {
          newParams.set('q', searchInput);
          if (!currentSearch) {
            newParams.delete('sort');
            newParams.delete('season');
            newParams.delete('year');
          }
        } else {
          newParams.delete('q');
          if (!newParams.get('sort') && !newParams.get('season') && !newParams.get('type') && !newParams.get('status')) {
            newParams.set('sort', 'popular');
          }
        }
        setSearchParams(newParams);
      }
    }, 300);
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [searchInput, currentSearch, searchParams, setSearchParams]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = 'Browse Anime - AniShows';
  }, [currentGenres.join(','), currentSort, currentSearch, currentTypes, currentStatuses]);

  // Filter helpers
  const updateParam = useCallback((key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const toggleArrayParam = useCallback((key, value) => {
    const newParams = new URLSearchParams(searchParams);
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
  }, []);

  const toggleLocalGenre = useCallback((genreSlug) => {
    setLocalFilters(prev => {
      const current = prev.genres;
      const updated = current.includes(genreSlug)
        ? current.filter(g => g !== genreSlug)
        : [...current, genreSlug];
      return { ...prev, genres: updated };
    });
  }, []);

  const hasActiveFilters = currentGenres.length > 0 || currentTypes || currentStatuses || currentStudio || currentSeason || currentYearParam || currentMinRating || currentMaxRating;

  // Filter sidebar props
  const filterSidebarProps = {
    genres,
    studios,
    isGenresError,
    isStudiosError,
    localFilters,
    collapsedSections,
    onToggleSection: toggleSection,
    onUpdateFilter: updateLocalFilter,
    onToggleGenre: toggleLocalGenre,
    hasUnappliedChanges,
    onApplyFilters: applyFilters,
    onResetFilters: resetFilters,
    typeOptions: TYPE_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    seasonOptions: SEASON_OPTIONS,
    yearOptions: YEAR_OPTIONS,
  };

  return (
    <>
      <SEO page="browse" />
      <LoadingBar isLoading={isLoading || isTabSwitching} />

      <div className="min-h-screen py-4 sm:py-8 px-3 sm:px-4 lg:px-6">
        <div className="max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="text-center mb-8 sm:mb-10">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-3 sm:mb-4 tracking-tight">
              Discover Anime
            </h1>
            <p className="text-gray-400 max-w-xl mx-auto text-sm sm:text-base px-4">
              Explore our collection of anime series and find your next favorite.
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative max-w-2xl mx-auto mb-4 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search anime, genres, studios..."
              className="w-full bg-dark-100 border border-gray-700 rounded-2xl pl-12 pr-12 py-4 text-white placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Quick Filters */}
          <div className="max-w-2xl mx-auto mb-6">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {QUICK_FILTER_GENRES.map((genreSlug) => {
                const genre = genres?.find(g => g.slug === genreSlug);
                if (!genre) return null;
                const isActive = currentGenres.includes(genreSlug);
                return (
                  <button
                    key={genreSlug}
                    onClick={() => toggleArrayParam('genre', genreSlug)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${isActive
                      ? 'bg-accent text-white shadow-sm shadow-accent/20'
                      : 'bg-dark-100 text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600'
                      }`}
                  >
                    {genre.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Browse Tabs */}
          <div className="mb-6 -mx-3 sm:-mx-4 px-3 sm:px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 animate-fade-in min-w-max sm:justify-center">
              {currentSearch && (
                <button
                  onClick={() => {
                    const newParams = new URLSearchParams(searchParams);
                    newParams.delete('sort');
                    newParams.delete('season');
                    newParams.delete('year');
                    setSearchParams(newParams);
                    setActiveTab('search');
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap
                    ${activeTab === 'search'
                      ? 'bg-accent text-white shadow-lg shadow-accent/25 scale-105'
                      : 'bg-dark-100 text-gray-400 border border-gray-700 hover:text-white hover:border-gray-600'
                    }`}
                >
                  <Search className={`w-4 h-4 ${activeTab === 'search' ? 'text-white' : 'text-gray-500'}`} />
                  All Results
                </button>
              )}
              {BROWSE_TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => handleTabChange(tab.key)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap
                      ${isActive
                        ? 'bg-accent text-white shadow-lg shadow-accent/25 scale-105'
                        : 'bg-dark-100 text-gray-400 border border-gray-700 hover:text-white hover:border-gray-600'
                      }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Layout */}
          <div className="flex gap-6 lg:gap-8">
            {/* Filter Sidebar - Desktop */}
            <aside className="hidden lg:block w-60 flex-shrink-0">
              <div className="sticky top-24 bg-dark-100/50 backdrop-blur-sm rounded-2xl border border-gray-800 p-5 h-[calc(100vh-7rem)] overflow-y-auto custom-scrollbar">
                <div className="flex items-center gap-2 mb-5 pb-4 border-b border-gray-800">
                  <Filter className="w-5 h-5 text-accent" />
                  <h2 className="text-base font-bold text-white/90">Filters</h2>
                </div>
                <FilterSidebar {...filterSidebarProps} />
              </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 min-w-0">
              {/* Trending Carousel */}
              {showHero && (
                <TrendingCarousel
                  anime={trendingHero}
                  onSeeAll={() => handleTabChange('trending')}
                  titleLanguage={titleLanguage}
                  isError={isHeroError}
                />
              )}

              {/* Controls Bar */}
              <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-accent font-bold text-lg">{totalCount.toLocaleString()}</span>
                    <span className="text-gray-500 text-sm">results</span>
                  </p>

                  {/* Mobile Filter Toggle */}
                  <button
                    onClick={() => setShowFilters(true)}
                    className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 bg-dark-100 border border-gray-700 rounded-lg text-sm text-gray-300 hover:border-accent transition-colors"
                  >
                    <Filter className="w-4 h-4" />
                    Filters
                    {(hasActiveFilters || hasUnappliedChanges) && (
                      <span className="w-2 h-2 bg-accent rounded-full" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />

                  {/* Title Language Toggle */}
                  <button
                    onClick={() => setTitleLanguage(titleLanguage === 'en' ? 'jp' : 'en')}
                    className="hidden sm:flex items-center justify-center w-9 h-9 bg-dark-100 border border-gray-700 rounded-lg text-[11px] font-bold text-gray-300 hover:border-accent transition-colors"
                    title="Toggle title language"
                  >
                    {titleLanguage === 'en' ? 'EN' : 'JP'}
                  </button>
                </div>
              </div>

              {/* Active Filter Chips */}
              <ActiveFilterChips
                currentTypes={currentTypes}
                currentStatuses={currentStatuses}
                currentSeason={currentSeason}
                currentYear={currentYearParam}
                currentMinRating={currentMinRating}
                currentMaxRating={currentMaxRating}
                currentStudio={currentStudio}
                currentGenres={currentGenres}
                typeOptions={TYPE_OPTIONS}
                statusOptions={STATUS_OPTIONS}
                seasonOptions={SEASON_OPTIONS}
                studios={studios}
                genres={genres}
                onClearType={() => updateParam('type', '')}
                onClearStatus={() => updateParam('status', '')}
                onClearSeason={() => { updateParam('season', ''); updateParam('year', ''); }}
                onClearMinRating={() => updateParam('min_rating', '')}
                onClearMaxRating={() => updateParam('max_rating', '')}
                onClearStudio={() => updateParam('studio', '')}
                onToggleGenre={(genre) => toggleArrayParam('genre', genre)}
                onClearAll={clearAllFilters}
                hasActiveFilters={hasActiveFilters}
              />

              {/* Anime Content */}
              {renderContent()}
            </main>
          </div>
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      <MobileFilterDrawer
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={handleApplyMobile}
        isApplying={isApplyingFilters}
        filterSidebarProps={filterSidebarProps}
      />
    </>
  );

  function renderContent() {
    // Grid View
    if (viewMode === 'grid') {
      return (
        <div>
          {isLoading || isTabSwitching ? (
            <div className="skeleton-fade-in">
              <GridSkeleton count={skeletonCount} />
              <div ref={loadMoreRef} className="h-0 overflow-hidden" />
            </div>
          ) : isError ? (
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
          ) : allAnime.length === 0 ? (
            <EmptyState
              onClearFilters={clearAllFilters}
              hasActiveFilters={hasActiveFilters || currentSearch !== ''}
              searchQuery={currentSearch}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 lg:gap-5">
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
          {isLoading || isTabSwitching ? (
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
        {isLoading || isTabSwitching ? (
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