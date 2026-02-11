import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, SlidersHorizontal, ChevronDown, ChevronUp, X, Grid3X3, List, LayoutGrid, Filter, ChevronRight, Star, Building2, Calendar, Tv, Plus, TrendingUp, Play, Trophy, Clock, Sparkles, ArrowDownAZ, Users, Eye } from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { animeApi, genreApi, studioApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Browse Tabs for quick context switching
const BROWSE_TABS = [
    { key: 'popular', label: 'Most Popular', icon: Users },
    { key: 'current', label: 'This Season', icon: Play },
    { key: 'upcoming', label: 'Upcoming', icon: Clock },
    { key: 'top', label: 'All Time Best', icon: Trophy },
    { key: 'newest', label: 'Newest', icon: Sparkles },
    { key: 'title', label: 'A-Z', icon: ArrowDownAZ },
];

const SORT_OPTIONS = [
    { value: 'trending', label: 'Trending Now' },
    { value: 'popular', label: 'Most Popular' },
    { value: 'rating', label: 'Highest Rated' },
    { value: 'newest', label: 'Newest' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'title', label: 'A-Z' },
];

const TYPE_OPTIONS = [
    { value: 'TV', label: 'TV Series' },
    { value: 'Movie', label: 'Movies' },
    { value: 'OVA', label: 'OVA' },
    { value: 'Special', label: 'Specials' },
];

const STATUS_OPTIONS = [
    { value: 'Airing', label: 'Currently Airing' },
    { value: 'Finished', label: 'Finished' },
    { value: 'Upcoming', label: 'Not Yet Aired' },
];

const SEASON_OPTIONS = [
    { value: 'winter', label: 'Winter (Jan-Mar)' },
    { value: 'spring', label: 'Spring (Apr-Jun)' },
    { value: 'summer', label: 'Summer (Jul-Sep)' },
    { value: 'fall', label: 'Fall (Oct-Dec)' },
];

const VIEW_MODES = [
    { value: 'grid', icon: Grid3X3, label: 'Grid' },
    { value: 'list', icon: List, label: 'List' },
    { value: 'minimal', icon: LayoutGrid, label: 'Minimal' },
];

// Generate year options from 1960 to current year + 1
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: currentYear - 1960 + 2 }, (_, i) => currentYear + 1 - i);



export default function Browse() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('browse_view_mode') || 'grid');
    const [titleLanguage, setTitleLanguage] = useState(() => localStorage.getItem('title_language') || 'en');
    const [activeTab, setActiveTab] = useState('popular');
    const { isAuthenticated } = useAuth();
    // Collapsible filter sections state
    const [collapsedSections, setCollapsedSections] = useState(() => {
        const saved = localStorage.getItem('browse_collapsed_sections');
        return saved ? JSON.parse(saved) : { genres: true };
    });
    const [genreSearch, setGenreSearch] = useState('');
    const [showAllGenres, setShowAllGenres] = useState(false);

    // Quick filter genres (popular ones)
    const QUICK_FILTER_GENRES = useMemo(() => ['action', 'romance', 'comedy', 'fantasy', 'drama', 'sci-fi'], []);

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
        else if (currentSort === 'popular') setActiveTab('popular');
        else setActiveTab(null);
    }, [currentSort, currentSeason, currentYearParam]);

    const handleTabChange = useCallback((key) => {
        const newParams = new URLSearchParams(searchParams);

        // Reset base filters
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
        setSearchParams(newParams);
    }, [searchParams, setSearchParams]);

    // Fetch genres
    const { data: genres } = useQuery({
        queryKey: ['genres'],
        queryFn: () => genreApi.getAll().then(res => res.data),
        staleTime: 1000 * 60 * 30,
    });

    // Fetch studios
    const { data: studios } = useQuery({
        queryKey: ['studios'],
        queryFn: () => studioApi.getAll().then(res => res.data),
        staleTime: 1000 * 60 * 30,
    });

    // Fetch anime with infinite query - Reduced page size for better performance
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError,
    } = useInfiniteQuery({
        queryKey: ['anime', 'list', currentGenres.join(','), currentSort, currentSearch, currentTypes, currentStatuses, currentStudio, currentSeason, currentYearParam, currentMinRating, currentMaxRating],
        queryFn: ({ pageParam = 1 }) =>
            animeApi.getAll({
                page: pageParam,
                page_size: 12, // Reduced from default to minimize initial load
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
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                const url = new URL(lastPage.next);
                return url.searchParams.get('page');
            }
            return undefined;
        },
        staleTime: 1000 * 60 * 5,
    });

    // Persist view mode
    useEffect(() => {
        localStorage.setItem('browse_view_mode', viewMode);
    }, [viewMode]);

    useEffect(() => {
        localStorage.setItem('title_language', titleLanguage);
    }, [titleLanguage]);

    // Fetch trending anime for Hero Section
    const { data: trendingHero } = useQuery({
        queryKey: ['anime', 'hero-trending'],
        queryFn: () => animeApi.getTrending().then(res => res.data),
        staleTime: 1000 * 60 * 30,
    });

    // Determine if we should show hero section
    const showHero = activeTab === 'popular' && !currentSearch && !currentGenres.length;

    // Flatten all anime data
    const allAnime = useMemo(() => 
        data?.pages.flatMap(page => page.results) || [],
        [data]
    );
    const totalCount = data?.pages[0]?.count || 0;



    // Infinite scroll with IntersectionObserver
    const loadMoreRef = useRef(null);
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { threshold: 0.1, rootMargin: '200px' }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    // Search debounce
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (searchInput !== currentSearch) {
                const newParams = new URLSearchParams(searchParams);
                if (searchInput) {
                    newParams.set('q', searchInput);
                } else {
                    newParams.delete('q');
                }
                setSearchParams(newParams);
            }
        }, 300);
        return () => clearTimeout(timeout);
    }, [searchInput, currentSearch, searchParams, setSearchParams]);

    useEffect(() => {
        window.scrollTo({ top: 0 });
        document.title = 'Browse Anime - AniShows';
    }, [currentGenres.join(','), currentSort, currentSearch, currentTypes, currentStatuses]);

    // Filter update helpers
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

    const clearAllFilters = useCallback(() => {
        setSearchParams({});
        setSearchInput('');
    }, [setSearchParams]);

    const toggleSection = useCallback((section) => {
        const newCollapsed = { ...collapsedSections, [section]: !collapsedSections[section] };
        setCollapsedSections(newCollapsed);
        localStorage.setItem('browse_collapsed_sections', JSON.stringify(newCollapsed));
    }, [collapsedSections]);

    const hasActiveFilters = currentGenres.length > 0 || currentTypes || currentStatuses || currentStudio || currentSeason || currentYearParam || currentMinRating || currentMaxRating;

    // Filter Sidebar Component
    const FilterSidebar = useCallback(({ className = '', isMobile = false }) => {
        const filteredGenres = genres?.filter(g =>
            g.name.toLowerCase().includes(genreSearch.toLowerCase())
        ) || [];
        const displayedGenres = showAllGenres ? filteredGenres : filteredGenres.slice(0, 10);

        const SectionHeader = ({ icon: Icon, title, section, count }) => (
            <button
                onClick={() => toggleSection(section)}
                className="w-full flex items-center justify-between text-base font-bold text-white mb-3 hover:text-accent transition-colors group"
            >
                <span className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-accent" />
                    <span className="uppercase tracking-wide text-sm">{title}</span>
                    {count > 0 && (
                        <span className="text-xs text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">{count}</span>
                    )}
                </span>
                {collapsedSections[section] ? (
                    <ChevronDown className="w-4 h-4 text-gray-500 group-hover:text-accent transition-colors" />
                ) : (
                    <ChevronUp className="w-4 h-4 text-gray-500 group-hover:text-accent transition-colors" />
                )}
            </button>
        );

        return (
            <div className={`${className} space-y-5`}>
                {/* Format/Type */}
                <div>
                    <SectionHeader icon={Tv} title="Format" section="format" count={currentTypes ? 1 : 0} />
                    {!collapsedSections.format && (
                        <div className="space-y-2 animate-fade-in">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${!currentTypes ? 'border-accent bg-accent' : 'border-gray-600 bg-dark-100 group-hover:border-gray-500'}`}>
                                    {!currentTypes && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </div>
                                <input
                                    type="radio"
                                    checked={!currentTypes}
                                    onChange={() => updateParam('type', '')}
                                    className="hidden"
                                />
                                <span className={`text-sm transition-colors ${!currentTypes ? 'text-white font-medium' : 'text-gray-400 group-hover:text-white'}`}>Any Format</span>
                            </label>
                            {TYPE_OPTIONS.map((type) => (
                                <label key={type.value} className="flex items-center gap-3 cursor-pointer group">
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${currentTypes === type.value ? 'border-accent bg-accent' : 'border-gray-600 bg-dark-100 group-hover:border-gray-500'}`}>
                                        {currentTypes === type.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                    <input
                                        type="radio"
                                        checked={currentTypes === type.value}
                                        onChange={() => updateParam('type', type.value)}
                                        className="hidden"
                                    />
                                    <span className={`text-sm transition-colors ${currentTypes === type.value ? 'text-white font-medium' : 'text-gray-400 group-hover:text-white'}`}>{type.label}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Status */}
                <div>
                    <SectionHeader icon={ChevronRight} title="Status" section="status" count={currentStatuses ? 1 : 0} />
                    {!collapsedSections.status && (
                        <div className="space-y-2 animate-fade-in">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${!currentStatuses ? 'border-accent bg-accent' : 'border-gray-600 bg-dark-100 group-hover:border-gray-500'}`}>
                                    {!currentStatuses && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </div>
                                <input
                                    type="radio"
                                    checked={!currentStatuses}
                                    onChange={() => updateParam('status', '')}
                                    className="hidden"
                                />
                                <span className={`text-sm transition-colors ${!currentStatuses ? 'text-white font-medium' : 'text-gray-400 group-hover:text-white'}`}>Any Status</span>
                            </label>
                            {STATUS_OPTIONS.map((status) => (
                                <label key={status.value} className="flex items-center gap-3 cursor-pointer group">
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${currentStatuses === status.value ? 'border-accent bg-accent' : 'border-gray-600 bg-dark-100 group-hover:border-gray-500'}`}>
                                        {currentStatuses === status.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                    <input
                                        type="radio"
                                        checked={currentStatuses === status.value}
                                        onChange={() => updateParam('status', status.value)}
                                        className="hidden"
                                    />
                                    <span className={`text-sm transition-colors ${currentStatuses === status.value ? 'text-white font-medium' : 'text-gray-400 group-hover:text-white'}`}>{status.label}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Season & Year */}
                <div>
                    <SectionHeader icon={Calendar} title="Season" section="season" count={(currentSeason || currentYearParam) ? 1 : 0} />
                    {!collapsedSections.season && (
                        <div className="grid grid-cols-2 gap-2 animate-fade-in">
                            <select
                                value={currentSeason}
                                onChange={(e) => updateParam('season', e.target.value)}
                                className="bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent"
                            >
                                <option value="">Any Season</option>
                                {SEASON_OPTIONS.map((s) => (
                                    <option key={s.value} value={s.value}>{s.label.split(' ')[0]}</option>
                                ))}
                            </select>
                            <select
                                value={currentYearParam}
                                onChange={(e) => updateParam('year', e.target.value)}
                                className="bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent"
                            >
                                <option value="">Any Year</option>
                                {YEAR_OPTIONS.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* Rating Range */}
                <div>
                    <SectionHeader icon={Star} title="Rating" section="rating" count={(currentMinRating || currentMaxRating) ? 1 : 0} />
                    {!collapsedSections.rating && (
                        <div className="flex items-center gap-2 animate-fade-in">
                            <input
                                type="number"
                                min="0"
                                max="10"
                                step="0.5"
                                placeholder="Min"
                                value={currentMinRating}
                                onChange={(e) => updateParam('min_rating', e.target.value)}
                                className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent"
                            />
                            <span className="text-gray-500">-</span>
                            <input
                                type="number"
                                min="0"
                                max="10"
                                step="0.5"
                                placeholder="Max"
                                value={currentMaxRating}
                                onChange={(e) => updateParam('max_rating', e.target.value)}
                                className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent"
                            />
                        </div>
                    )}
                </div>

                {/* Studios */}
                <div>
                    <SectionHeader icon={Building2} title="Studio" section="studio" count={currentStudio ? 1 : 0} />
                    {!collapsedSections.studio && (
                        <select
                            value={currentStudio}
                            onChange={(e) => updateParam('studio', e.target.value)}
                            className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent animate-fade-in"
                        >
                            <option value="">All Studios</option>
                            {studios?.map((studio) => (
                                <option key={studio.id} value={studio.id}>{studio.name}</option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Genres */}
                <div>
                    <SectionHeader icon={Filter} title="Genres" section="genres" count={currentGenres.length} />
                    {!collapsedSections.genres && (
                        <div className="space-y-3 animate-fade-in">
                            {genres?.length > 10 && (
                                <div className="sticky top-0 bg-dark-100/95 backdrop-blur-sm py-1 -mx-1 px-1 z-10">
                                    <input
                                        type="text"
                                        placeholder="Search genres..."
                                        value={genreSearch}
                                        onChange={(e) => setGenreSearch(e.target.value)}
                                        className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent placeholder:text-gray-600"
                                    />
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                                {displayedGenres.map((genre) => {
                                    const isSelected = currentGenres.includes(genre.slug);
                                    return (
                                        <button
                                            key={genre.id}
                                            onClick={() => toggleArrayParam('genre', genre.slug)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all
                                                ${isSelected
                                                    ? 'bg-accent text-white shadow-sm shadow-accent/30'
                                                    : 'bg-dark-100 text-gray-400 border border-gray-700 hover:border-accent hover:text-white'}`}
                                        >
                                            {genre.name}
                                        </button>
                                    );
                                })}
                            </div>
                            {filteredGenres.length > 10 && !genreSearch && (
                                <button
                                    onClick={() => setShowAllGenres(!showAllGenres)}
                                    className="text-xs text-accent hover:text-accent-light transition-colors font-medium"
                                >
                                    {showAllGenres ? 'Show Less' : `Show All (${filteredGenres.length})`}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Clear Filters */}
                {hasActiveFilters && (
                    <button
                        onClick={clearAllFilters}
                        className="w-full py-2.5 text-sm font-bold text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/50 rounded-xl transition-colors"
                    >
                        Clear All Filters
                    </button>
                )}
            </div>
        );
    }, [genres, studios, collapsedSections, currentGenres, currentTypes, currentStatuses, currentSeason, currentYearParam, currentMinRating, currentMaxRating, currentStudio, genreSearch, showAllGenres, hasActiveFilters, toggleSection, updateParam, toggleArrayParam, clearAllFilters]);

    // List View Row Component
    const AnimeListRow = useCallback(({ anime }) => (
        <Link
            to={`/anime/${anime.slug}`}
            className="flex items-center gap-4 p-4 bg-dark-100/50 hover:bg-dark-100 rounded-xl border border-gray-800 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5 transition-all group"
        >
            <img
                src={anime.cover_image}
                alt={anime.title}
                loading="lazy"
                className="w-16 h-24 object-cover rounded-lg flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-white group-hover:text-accent transition-colors line-clamp-1">
                        {titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title}
                    </h3>
                    {anime.status && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${anime.status === 'Airing' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                            anime.status === 'Upcoming' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                            }`}>
                            {anime.status}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300 mt-1 flex-wrap">
                    <span className="text-gray-200">{anime.anime_type}</span>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-200">{anime.episode_count || '?'} eps</span>
                    {(anime.start_date || anime.release_date) && (
                        <>
                            <span className="text-gray-500">•</span>
                            <span className="text-gray-400">{new Date(anime.start_date || anime.release_date).getFullYear()}</span>
                        </>
                    )}
                    {(anime.studio_name || anime.studios?.[0]?.name) && (
                        <>
                            <span className="text-gray-500">•</span>
                            <span className="text-accent/80 font-medium">{anime.studio_name || anime.studios?.[0]?.name}</span>
                        </>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {anime.genres?.slice(0, 4).map((genre) => (
                        <span key={genre.id} className="px-2 py-0.5 bg-dark-50 text-xs text-gray-300 rounded-md border border-gray-700">
                            {genre.name}
                        </span>
                    ))}
                </div>
            </div>
            <div className="text-right flex-shrink-0 flex flex-col items-end gap-2">
                {anime.rating && (
                    <div className="flex items-center gap-1 text-yellow-500">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="font-bold">{anime.rating}</span>
                    </div>
                )}
            </div>
        </Link>
    ), [titleLanguage]);

    // Minimal Card Component
    const AnimeMinimalCard = useCallback(({ anime }) => (
        <Link
            to={`/anime/${anime.slug}`}
            className="block aspect-[2/3] rounded-lg overflow-hidden relative group"
        >
            <img
                src={anime.cover_image}
                alt={anime.title}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-2 left-2 right-2">
                    <h3 className="text-xs font-bold text-white line-clamp-2">
                        {titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title}
                    </h3>
                </div>
            </div>
        </Link>
    ), [titleLanguage]);



    return (
        <div className="min-h-screen py-4 sm:py-8 px-3 sm:px-4">
            <div className="max-w-[1600px] mx-auto">
                {/* Header */}
                <div className="text-center mb-6 sm:mb-8">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-3 sm:mb-4">
                        Discover Anime
                    </h1>
                    <p className="text-gray-400 max-w-xl mx-auto text-sm sm:text-base px-4">
                        Explore our collection of anime series and find your next favorite.
                    </p>
                </div>

                {/* Search Bar */}
                <div className="relative max-w-3xl mx-auto mb-3 sm:mb-4 group">
                    <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-5 h-5 sm:w-6 sm:h-6 text-gray-500 group-focus-within:text-accent transition-colors" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search for anime, genres, studios..."
                        className="w-full bg-dark-100 border-2 border-gray-800 rounded-xl sm:rounded-2xl pl-11 sm:pl-14 pr-11 sm:pr-14 py-3 sm:py-4 text-base sm:text-xl text-white placeholder:text-gray-600 focus:border-accent focus:ring-4 focus:ring-accent/10 outline-none transition-all shadow-2xl"
                    />
                    {searchInput && (
                        <button
                            onClick={() => setSearchInput('')}
                            className="absolute right-4 sm:right-5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                    )}
                </div>

                {/* Quick Filters */}
                <div className="max-w-3xl mx-auto mb-4 sm:mb-6">
                    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                        <span className="text-xs text-gray-500 mr-1 hidden sm:inline">Quick filters:</span>
                        {QUICK_FILTER_GENRES.map((genreSlug) => {
                            const genre = genres?.find(g => g.slug === genreSlug);
                            if (!genre) return null;
                            const isActive = currentGenres.includes(genreSlug);
                            return (
                                <button
                                    key={genreSlug}
                                    onClick={() => toggleArrayParam('genre', genreSlug)}
                                    className={`px-2 sm:px-3 py-1 rounded-full text-xs font-medium transition-all ${isActive
                                        ? 'bg-accent text-white'
                                        : 'bg-dark-100/80 text-gray-400 hover:text-white hover:bg-dark-50 border border-gray-700/50'
                                        }`}
                                >
                                    {genre.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Browse Tabs */}
                <div className="mb-4 sm:mb-6 -mx-3 sm:-mx-4 px-3 sm:px-4 overflow-x-auto scrollbar-hide">
                    <div className="flex gap-2 animate-fade-in min-w-max sm:justify-center">
                        {BROWSE_TABS.map((tab) => {
                            const isActive = activeTab === tab.key;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => handleTabChange(tab.key)}
                                    className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all whitespace-nowrap
                                        ${isActive
                                            ? 'bg-accent text-white shadow-lg shadow-accent/20 scale-105'
                                            : 'bg-dark-100 text-gray-400 border border-gray-800 hover:text-white hover:border-gray-600'
                                        }`}
                                >
                                    <tab.icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Main Layout */}
                <div className="flex gap-8">
                    {/* Filter Sidebar - Desktop */}
                    <aside className="hidden lg:block w-64 flex-shrink-0">
                        <div className="sticky top-24 bg-dark-100/30 backdrop-blur-md rounded-2xl border border-gray-800 p-6 max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar">
                            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                                <Filter className="w-5 h-5 text-accent" />
                                Filters
                            </h2>
                            <FilterSidebar />
                        </div>
                    </aside>

                    {/* Main Content */}
                    <main className="flex-1 min-w-0">
                        {/* Hero Section */}
                        {showHero && trendingHero && (
                            <div className="mb-10 animate-fade-in">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-accent" />
                                        Trending Now
                                    </h2>
                                    <button
                                        onClick={() => handleTabChange('trending')}
                                        className="text-sm font-bold text-accent hover:text-white transition-colors flex items-center gap-1 group"
                                    >
                                        View All
                                        <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {trendingHero.slice(0, 3).map((anime, index) => (
                                        <div key={anime.id} className="relative aspect-[16/9] md:aspect-[4/3] lg:aspect-[16/9] rounded-2xl overflow-hidden group border border-gray-800 hover:border-accent/50 transition-all duration-500 hover:shadow-2xl hover:shadow-accent/10">
                                            <img
                                                src={anime.cover_image}
                                                alt={anime.title}
                                                loading="lazy"
                                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                            />
                                            {anime.user_list_status?.status === 'Watching' && anime.episode_count > 0 && (
                                                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60 z-20">
                                                    <div
                                                        style={{ width: `${Math.min((anime.user_list_status.episodes_watched / anime.episode_count) * 100, 100)}%` }}
                                                        className="h-full bg-purple-500"
                                                    />
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent p-6 flex flex-col justify-end">
                                                <div className="transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="px-2 py-0.5 bg-accent text-white text-[10px] font-bold rounded uppercase tracking-wider">
                                                            #{index + 1} Trending
                                                        </span>
                                                        {anime.rating && (
                                                            <span className="flex items-center gap-1 text-yellow-400 text-xs font-bold">
                                                                <Star className="w-3 h-3 fill-current" />
                                                                {anime.rating}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h3 className="text-xl md:text-2xl font-bold text-white mb-2 line-clamp-1">
                                                        {titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title}
                                                    </h3>
                                                    <p className="text-gray-300 text-sm line-clamp-2 mb-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100 hidden md:block">
                                                        {anime.synopsis}
                                                    </p>
                                                    <Link
                                                        to={`/anime/${anime.slug}`}
                                                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-accent text-white rounded-lg backdrop-blur-sm text-sm font-bold transition-all"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                        View Details
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Controls Bar */}
                        <div className="flex flex-wrap justify-between gap-4 mb-4">
                            <div className="flex gap-4">
                                <p className="text-gray-400 text-sm flex gap-1.5">
                                    <span className="text-accent font-bold text-base">{totalCount}</span>
                                    <span>results</span>
                                </p>

                                {/* Mobile Filter Toggle */}
                                <button
                                    onClick={() => setShowFilters(true)}
                                    className="lg:hidden flex items-center gap-2 px-3 py-1.5 bg-dark-100 border border-gray-700 rounded-lg text-sm text-gray-300 hover:border-accent transition-colors"
                                >
                                    <Filter className="w-4 h-4" />
                                    Filters
                                    {hasActiveFilters && (
                                        <span className="w-2 h-2 bg-accent rounded-full" />
                                    )}
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                {/* View Mode Toggle */}
                                <div className="hidden sm:flex items-center bg-dark-100 border border-gray-700 rounded-xl p-1">
                                    {VIEW_MODES.map((mode) => (
                                        <button
                                            key={mode.value}
                                            onClick={() => setViewMode(mode.value)}
                                            title={mode.label}
                                            className={`p-1.5 rounded-lg transition-colors ${viewMode === mode.value
                                                ? 'bg-accent text-white'
                                                : 'text-gray-400 hover:text-white'
                                                }`}
                                        >
                                            <mode.icon className="w-4 h-4" />
                                        </button>
                                    ))}
                                </div>

                                {/* Title Language Toggle */}
                                <button
                                    onClick={() => setTitleLanguage(titleLanguage === 'en' ? 'jp' : 'en')}
                                    className="hidden sm:flex items-center gap-2 px-3 py-2 bg-dark-100 border border-gray-700 rounded-xl text-xs font-bold text-gray-300 hover:border-accent transition-colors"
                                    title="Toggle title language"
                                >
                                    {titleLanguage === 'en' ? 'EN' : 'JP'}
                                </button>
                            </div>
                        </div>

                        {/* Active Filters Pills */}
                        {hasActiveFilters && (
                            <div className="flex flex-wrap gap-2 mb-6">
                                {currentTypes && (
                                    <button
                                        onClick={() => updateParam('type', '')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm border border-accent/30"
                                    >
                                        {TYPE_OPTIONS.find(t => t.value === currentTypes)?.label}
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                                {currentStatuses && (
                                    <button
                                        onClick={() => updateParam('status', '')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm border border-accent/30"
                                    >
                                        {STATUS_OPTIONS.find(s => s.value === currentStatuses)?.label}
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                                {currentSeason && (
                                    <button
                                        onClick={() => updateParam('season', '')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm border border-accent/30"
                                    >
                                        {SEASON_OPTIONS.find(s => s.value === currentSeason)?.label.split(' ')[0]} {currentYearParam}
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                                {currentMinRating && (
                                    <button
                                        onClick={() => updateParam('min_rating', '')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm border border-accent/30"
                                    >
                                        Rating ≥ {currentMinRating}
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                                {currentStudio && (
                                    <button
                                        onClick={() => updateParam('studio', '')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm border border-accent/30"
                                    >
                                        {studios?.find(s => s.id.toString() === currentStudio)?.name}
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                                {currentGenres.map((genre) => (
                                    <button
                                        key={genre}
                                        onClick={() => toggleArrayParam('genre', genre)}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm border border-accent/30"
                                    >
                                        {genres?.find(g => g.slug === genre)?.name}
                                        <X className="w-3 h-3" />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Anime Grid */}
                        {viewMode === 'grid' && (
                            <div>
                                {isLoading ? (
                                    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5">
                                        {Array(12).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                                    </div>
                                ) : isError ? (
                                    <div className="text-center py-16">
                                        <p className="text-red-400 mb-4">Failed to load anime</p>
                                        <button onClick={() => window.location.reload()} className="btn-primary">
                                            Reload
                                        </button>
                                    </div>
                                ) : allAnime.length === 0 ? (
                                    <div className="text-center py-16">
                                        <p className="text-gray-400 mb-4">No anime found matching your criteria</p>
                                        <button onClick={clearAllFilters} className="btn-secondary">
                                            Clear Filters
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5">
                                            {allAnime.map((anime, index) => (
                                                <AnimeCard
                                                    key={anime.id}
                                                    anime={anime}
                                                    titleLanguage={titleLanguage}
                                                    rank={currentSort === 'rating' ? (index + 1) : null}
                                                />
                                            ))}
                                        </div>
                                        {/* Load more trigger */}
                                        <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
                                            {isFetchingNextPage && (
                                                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* List View */}
                        {viewMode === 'list' && (
                            <div className="space-y-3">
                                {isLoading ? (
                                    Array(8).fill(0).map((_, i) => (
                                        <div key={i} className="h-32 bg-dark-100/50 rounded-xl animate-pulse" />
                                    ))
                                ) : allAnime.length === 0 ? (
                                    <div className="text-center py-16">
                                        <p className="text-gray-400 mb-4">No anime found matching your criteria</p>
                                        <button onClick={clearAllFilters} className="btn-secondary">
                                            Clear Filters
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {allAnime.map((anime) => (
                                            <AnimeListRow key={anime.id} anime={anime} />
                                        ))}
                                        <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
                                            {isFetchingNextPage && (
                                                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Minimal View */}
                        {viewMode === 'minimal' && (
                            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                {isLoading ? (
                                    Array(20).fill(0).map((_, i) => (
                                        <div key={i} className="aspect-[2/3] bg-dark-100 rounded-lg animate-pulse" />
                                    ))
                                ) : allAnime.length === 0 ? (
                                    <div className="col-span-full text-center py-16">
                                        <p className="text-gray-400 mb-4">No anime found</p>
                                    </div>
                                ) : (
                                    <>
                                        {allAnime.map((anime) => (
                                            <AnimeMinimalCard key={anime.id} anime={anime} />
                                        ))}
                                        <div ref={loadMoreRef} className="col-span-full h-10 flex justify-center items-center py-8">
                                            {isFetchingNextPage && (
                                                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </main>
                </div>
            </div>

            {/* Mobile Filter Drawer */}
            {showFilters && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFilters(false)} />
                    <div className="absolute right-0 top-0 bottom-0 w-full max-w-[320px] bg-dark-100 border-l border-gray-800 overflow-y-auto">
                        <div className="sticky top-0 bg-dark-100 border-b border-gray-800 p-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white">Filters</h2>
                            <button
                                onClick={() => setShowFilters(false)}
                                className="p-2 text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4 sm:p-6">
                            <FilterSidebar isMobile />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
