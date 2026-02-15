import { Link, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { Search, Menu, X, User, LogOut, ChevronDown, AlertCircle, RefreshCw, CheckCircle, Star, Loader2, Play, Calendar, Heart, Tv, Bell, Clock, Command, Sparkles } from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { authApi, animeApi } from '../api/client';
import { NotificationBell } from './NotificationBell';
import Fuse from 'fuse.js';

// Navigation Item Component with Active State
const NavItem = ({ to, icon: Icon, label, end = false }) => {  // eslint-disable-line no-unused-vars
    return (
        <NavLink
            to={to}
            end={end}
            title={label}
            className={({ isActive }) => `
                relative flex items-center gap-2 px-2 lg:px-3 py-2 rounded-lg font-medium transition-all duration-200
                ${isActive
                    ? 'text-white bg-white/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
            `}
        >
            {({ isActive }) => (
                <>
                    <Icon className="w-4 h-4" />
                    <span className="text-sm hidden lg:inline">{label}</span>
                    {isActive && (
                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-accent rounded-full" />
                    )}
                </>
            )}
        </NavLink>
    );
};

// Fuzzy search hook with better matching - defined OUTSIDE component
// Normalize text for better matching (remove punctuation, extra spaces)
const normalizeText = (text) => {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[.:,;!?-]/g, ' ')  // Replace punctuation with spaces
        .replace(/\s+/g, ' ')         // Collapse multiple spaces
        .trim();
};

const useFuzzySearch = (data, options = {}) => {
    // Pre-process data with normalized titles for better matching
    const processedData = useMemo(() => {
        return data.map(item => ({
            ...item,
            _normalizedTitle: normalizeText(item.title),
            _normalizedJp: normalizeText(item.title_jp)
        }));
    }, [data]);

    const fuse = useMemo(() => {
        const defaultOptions = {
            keys: [
                { name: 'title', weight: 0.6 },
                { name: '_normalizedTitle', weight: 0.3 },
                { name: 'title_jp', weight: 0.05 },
                { name: '_normalizedJp', weight: 0.05 }
            ],
            threshold: 0.35,
            distance: 200,
            includeScore: true,
            minMatchCharLength: 1,
            shouldSort: true,
            ignoreLocation: true,
            findAllMatches: true,
            useExtendedSearch: true,
            ...options
        };
        return new Fuse(processedData, defaultOptions);
    }, [processedData, options]);

    const search = useCallback((query) => {
        if (!query || query.trim().length < 1) return [];
        const normalizedQuery = normalizeText(query);

        // First, check for exact matches (including normalized)
        const exactMatches = processedData.filter(item => {
            const titleLower = item.title?.toLowerCase() || '';
            const normalizedTitle = item._normalizedTitle;
            const queryLower = query.toLowerCase();

            // Check original title
            if (titleLower.includes(queryLower)) return true;
            // Check normalized title
            if (normalizedTitle.includes(normalizedQuery)) return true;
            // Check word-by-word matching (for "Frieren Beyond" matching "Frieren: Beyond")
            const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);
            const titleWords = normalizedTitle.split(' ').filter(w => w.length > 0);
            if (queryWords.length > 1) {
                const allWordsMatch = queryWords.every(qw =>
                    titleWords.some(tw => tw.startsWith(qw) || tw.includes(qw))
                );
                if (allWordsMatch) return true;
            }
            return false;
        });

        // Get fuzzy results with extended search
        const fuzzyResults = fuse.search(query.trim(), { limit: 10 });

        // Combine and deduplicate, prioritizing exact matches
        const seen = new Set();
        const combined = [];

        // Add exact matches first
        exactMatches.forEach(item => {
            if (!seen.has(item.id)) {
                seen.add(item.id);
                combined.push({ ...item, isExactMatch: true });
            }
        });

        // Add fuzzy results
        fuzzyResults.forEach(result => {
            if (!seen.has(result.item.id)) {
                seen.add(result.item.id);
                combined.push({ ...result.item, isFuzzyMatch: true, matchScore: result.score });
            }
        });

        return combined;
    }, [fuse, processedData]);

    return { search };
};

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);  // eslint-disable-line no-unused-vars
    const [searchQuery, setSearchQuery] = useState('');
    const [searchSuggestions, setSearchSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [lastScrollY, setLastScrollY] = useState(0);
    const [allAnimeCache, setAllAnimeCache] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const { user, logout, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const profileRef = useRef(null);
    const notificationsRef = useRef(null);
    const searchRef = useRef(null);
    const searchInputRef = useRef(null);

    // Hide search on browse and anime detail pages (they have their own search/filters)
    const hideSearch = location.pathname.startsWith('/browse') || location.pathname.startsWith('/anime/');

    // Mock notifications (replace with real data later)
    const [notifications] = useState([
        { id: 1, type: 'episode', message: 'New episode of Attack on Titan is out!', time: '2 hours ago', read: false },
        { id: 2, type: 'like', message: 'Someone liked your review', time: '5 hours ago', read: false },
        { id: 3, type: 'system', message: 'Welcome to AniShows!', time: '1 day ago', read: true },
    ]);

    const unreadCount = notifications.filter(n => !n.read).length;  // eslint-disable-line no-unused-vars

    // Initialize fuzzy search with cache - options are now inside the hook
    const { search: fuzzySearch } = useFuzzySearch(allAnimeCache, {});

    // Load all anime data for fuzzy search on mount
    useEffect(() => {
        const loadAllAnime = async () => {
            try {
                // Load first 100 anime for fuzzy search
                const response = await animeApi.getAll({ page_size: 100 });
                setAllAnimeCache(response.data.results || []);
            } catch (error) {
                console.error('Failed to load anime cache:', error);
            }
        };
        loadAllAnime();
    }, []);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setIsProfileOpen(false);
            }
            if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
                setIsNotificationsOpen(false);
            }
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setShowSuggestions(false);
                setSelectedIndex(-1);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Hide/show navbar on scroll
    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            // Always show at top
            if (currentScrollY < 100) {
                setIsVisible(true);
            } else if (currentScrollY > lastScrollY && currentScrollY > 200) {
                // Scrolling down
                setIsVisible(false);
            } else if (currentScrollY < lastScrollY) {
                // Scrolling up
                setIsVisible(true);
            }

            setLastScrollY(currentScrollY);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [lastScrollY]);

    // Define handleSuggestionClick BEFORE the useEffect that uses it
    const handleSuggestionClick = useCallback((slug) => {
        navigate(`/anime/${slug}`);
        setSearchQuery('');
        setShowSuggestions(false);
        setSelectedIndex(-1);
        if (searchInputRef.current) {
            searchInputRef.current.blur();
        }
    }, [navigate]);

    // Enhanced keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // "/" to focus search
            if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                // Don't trigger if user is typing in an input
                if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                    return;
                }
                e.preventDefault();
                if (!hideSearch && searchInputRef.current) {
                    searchInputRef.current.focus();
                    setShowSuggestions(true);
                }
            }

            // ESC to blur search and close dropdowns
            if (e.key === 'Escape') {
                if (document.activeElement === searchInputRef.current) {
                    e.preventDefault();
                    searchInputRef.current.blur();
                    setShowSuggestions(false);
                    setSelectedIndex(-1);
                } else {
                    setShowSuggestions(false);
                    setIsProfileOpen(false);
                    setIsNotificationsOpen(false);
                }
            }

            // Arrow keys for navigation in suggestions
            if (showSuggestions && searchSuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(prev =>
                        prev < searchSuggestions.length - 1 ? prev + 1 : prev
                    );
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
                } else if (e.key === 'Enter' && selectedIndex >= 0) {
                    e.preventDefault();
                    handleSuggestionClick(searchSuggestions[selectedIndex].slug);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [hideSearch, showSuggestions, searchSuggestions, selectedIndex, handleSuggestionClick, navigate]);

    // Enhanced search with fuzzy matching - use ref to avoid dependency cycle
    const fuzzySearchRef = useRef(fuzzySearch);
    useEffect(() => {
        fuzzySearchRef.current = fuzzySearch;
    }, [fuzzySearch]);

    // Smooth search with minimum loading time to prevent flickering
    const MIN_LOADING_TIME = 300; // Minimum time to show loading spinner
    const searchTimeoutRef = useRef(null);
    const loadingStartTimeRef = useRef(0);

    useEffect(() => {
        // Clear any pending timeout
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (searchQuery.trim().length < 1) {
            setSearchSuggestions([]);
            setShowSuggestions(false);
            setSelectedIndex(-1);
            setIsSearching(false);
            return;
        }

        // Don't hide results immediately - keep showing old results while searching
        loadingStartTimeRef.current = Date.now();
        setIsSearching(true);

        searchTimeoutRef.current = setTimeout(async () => {
            try {
                // Get local fuzzy results for instant feedback
                const fuzzyResults = fuzzySearchRef.current(searchQuery.trim());

                // Also call the API to search the full database
                let apiResults = [];
                try {
                    const response = await animeApi.getAll({ q: searchQuery.trim(), page_size: 10 });
                    apiResults = (response.data.results || []).map(item => ({
                        ...item,
                        isApiResult: true
                    }));
                } catch (apiError) {
                    console.error('API search error:', apiError);
                    // Fall back to cache-only results if API fails
                }

                // Combine results: prioritize API results, add unique fuzzy results
                const seen = new Set();
                const combined = [];

                // Add API results first (they're from the full database)
                apiResults.forEach(item => {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        combined.push(item);
                    }
                });

                // Add fuzzy results that weren't in API results (might have better match scoring)
                fuzzyResults.forEach(item => {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        combined.push({ ...item, isFuzzyMatch: true });
                    }
                });

                // Calculate remaining time to meet minimum loading duration
                const elapsed = Date.now() - loadingStartTimeRef.current;
                const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsed);

                // Delay showing results to prevent flickering
                setTimeout(() => {
                    if (combined.length > 0) {
                        setSearchSuggestions(combined.slice(0, 8));
                        setShowSuggestions(true);
                    } else {
                        // No results - show empty state
                        setSearchSuggestions([]);
                        setShowSuggestions(true);
                    }
                    setIsSearching(false);
                }, remainingTime);
            } catch (error) {
                console.error('Search error:', error);
                setSearchSuggestions([]);
                setIsSearching(false);
            }
        }, 200); // Debounce delay

        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery]);

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/browse?q=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
            setShowSuggestions(false);
            setSelectedIndex(-1);
            if (searchInputRef.current) {
                searchInputRef.current.blur();
            }
        }
    };

    const [isResending, setIsResending] = useState(false);
    const [resendSuccess, setResendSuccess] = useState(false);

    const handleResendVerification = async () => {
        if (!user?.email) return;
        setIsResending(true);
        try {
            await authApi.resendVerification({ email: user.email });
            setResendSuccess(true);
            setTimeout(() => setResendSuccess(false), 5000);
        } catch (err) {
            console.error('Failed to resend verification:', err);
        } finally {
            setIsResending(false);
        }
    };

    const showVerificationBanner = isAuthenticated && user && user.email_verified === false;

    // Calculate user stats from API response
    const userStats = {
        animeWatched: user?.anime_count || 0,
        episodesWatched: user?.episodes_watched || 0,
        hoursWatched: Math.round((user?.days_watched || 0) * 24),
    };

    // Format hours
    const formatHours = (hours) => {
        if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k`;
        return hours.toString();
    };

    // Highlight matching text
    const highlightMatch = (text, query) => {
        if (!query || !text) return text;
        const parts = text.split(new RegExp(`(${query})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === query.toLowerCase() ? (
                <span key={i} className="text-accent font-semibold">{part}</span>
            ) : (
                part
            )
        );
    };

    return (
        <>
            {showVerificationBanner && (
                <div className="bg-yellow-500/10 border-b border-yellow-500/20 backdrop-blur-sm relative z-[60]">
                    <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4 text-sm">
                        <div className="flex items-center gap-2 text-yellow-500">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>
                                Please verify your email address to access all features.
                                <span className="hidden sm:inline"> Check your inbox for the verification link.</span>
                            </span>
                        </div>
                        {resendSuccess ? (
                            <div className="flex items-center gap-2 text-green-400 font-medium whitespace-nowrap">
                                <CheckCircle className="w-4 h-4" />
                                <span>Sent!</span>
                            </div>
                        ) : (
                            <button
                                onClick={handleResendVerification}
                                disabled={isResending}
                                className="flex items-center gap-2 text-yellow-500 hover:text-yellow-400 font-medium whitespace-nowrap disabled:opacity-50 transition-colors"
                            >
                                {isResending ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="w-4 h-4" />
                                )}
                                Resend Email
                            </button>
                        )}
                    </div>
                </div>
            )}
            <nav
                className={`fixed top-0 left-0 right-0 z-[1000] bg-dark/80 backdrop-blur-xl border-b border-gray-800 ${showVerificationBanner ? 'top-[40px]' : 'top-0'
                    } transition-all duration-300 ${isVisible ? 'translate-y-0' : '-translate-y-full'}`}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}
                        <Link to="/" className="flex items-center gap-2.5 group">
                            <div className="w-9 h-9 bg-gradient-to-br from-accent to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-accent/20 group-hover:shadow-accent/30 transition-shadow">
                                <Play className="w-5 h-5 text-white fill-current ml-0.5" />
                            </div>
                            <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                AniShows
                            </span>
                        </Link>

                        {/* Desktop Nav */}
                        <div className="hidden md:flex items-center gap-1 flex-1 ml-4 lg:ml-6">
                            <NavItem to="/browse" icon={Search} label="Browse" />
                            <NavItem to="/seasonal" icon={Calendar} label="Seasonal" />
                            <NavItem to="/schedule" icon={Tv} label="Schedule" />
                            {(isAuthenticated || authLoading) && (
                                <NavItem to="/profile" icon={Heart} label="My List" />
                            )}

                            {/* Search - Always Extended with Fuzzy Search */}
                            <div className="flex-1 flex justify-center mx-2 lg:mx-4" ref={searchRef}>
                                <div
                                    className={`relative transition-all duration-300 ease-out w-full max-w-[200px] lg:max-w-md ${hideSearch
                                        ? 'opacity-0 pointer-events-none'
                                        : 'opacity-100'
                                        }`}
                                >
                                    <form onSubmit={handleSearch} className="relative">
                                        <input
                                            ref={searchInputRef}
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => {
                                                setSearchQuery(e.target.value);
                                                setSelectedIndex(-1);
                                            }}
                                            onFocus={() => {
                                                if (searchQuery.trim().length >= 1) {
                                                    setShowSuggestions(true);
                                                }
                                            }}
                                            placeholder="Search anime..."
                                            className="w-full pl-11 pr-4 py-2.5 bg-dark-100 border border-gray-700/50 rounded-xl text-sm text-white
                                             placeholder:text-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all shadow-sm"
                                        />
                                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4">
                                            {isSearching ? (
                                                <Loader2 className="w-4 h-4 text-accent animate-spin" />
                                            ) : (
                                                <Search className="w-4 h-4 text-gray-400" />
                                            )}
                                        </div>

                                        {/* Clear button */}
                                        {searchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSearchQuery('');
                                                    setShowSuggestions(false);
                                                    setSelectedIndex(-1);
                                                    searchInputRef.current?.focus();
                                                }}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-all"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}

                                        {/* Keyboard shortcut hint */}
                                        {!searchQuery && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 pointer-events-none">
                                                <kbd className="px-1.5 py-0.5 bg-dark-50 rounded text-[10px] text-gray-500 border border-gray-700">/</kbd>
                                            </div>
                                        )}
                                    </form>

                                    {/* Enhanced Search Suggestions Dropdown - Always visible when active */}
                                    <div
                                        className={`absolute left-0 right-0 top-full mt-2 bg-dark-100 border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto transition-all duration-200 ${showSuggestions ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
                                            }`}
                                    >
                                        {isSearching && searchSuggestions.length === 0 ? (
                                            // Loading state - show previous results or skeleton
                                            <div className="py-6 text-center text-gray-400">
                                                <Loader2 className="w-6 h-6 mx-auto mb-2 text-accent animate-spin" />
                                                <p className="text-sm">Searching...</p>
                                            </div>
                                        ) : searchSuggestions.length > 0 ? (
                                            <>
                                                {searchSuggestions.map((anime, index) => (
                                                    <button
                                                        key={anime.id}
                                                        onClick={() => handleSuggestionClick(anime.slug)}
                                                        onMouseEnter={() => setSelectedIndex(index)}
                                                        className={`w-full flex items-center gap-3 p-3 transition-all text-left border-l-2 ${selectedIndex === index
                                                            ? 'bg-accent/10 border-accent'
                                                            : 'hover:bg-dark-50/50 border-transparent'
                                                            }`}
                                                    >
                                                        <img
                                                            src={anime.cover_image}
                                                            alt={anime.title}
                                                            className="w-10 h-14 object-cover rounded-md flex-shrink-0 shadow-sm"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="text-sm font-semibold text-white line-clamp-1">
                                                                {highlightMatch(anime.title, searchQuery)}
                                                            </h4>
                                                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                                                                <span className="text-gray-500">{anime.anime_type}</span>
                                                                {anime.episode_count && (
                                                                    <>
                                                                        <span className="text-gray-600">•</span>
                                                                        <span>{anime.episode_count} eps</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {anime.rating && (
                                                            <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/10 rounded-md flex-shrink-0">
                                                                <Star className="w-3 h-3 text-yellow-500 fill-current" />
                                                                <span className="text-xs font-semibold text-yellow-500">{anime.rating}</span>
                                                            </div>
                                                        )}
                                                        {anime.isExactMatch && (
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-accent/20 text-accent rounded-full flex-shrink-0">
                                                                Exact
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}

                                                <button
                                                    onClick={handleSearch}
                                                    className="w-full py-3 px-4 text-center text-sm font-medium text-accent hover:bg-dark-50 transition-colors border-t border-gray-700/50 flex items-center justify-center gap-2"
                                                >
                                                    <Search className="w-4 h-4" />
                                                    View all results for "{searchQuery}"
                                                </button>
                                            </>
                                        ) : searchQuery.trim().length >= 2 ? (
                                            <div className="py-8 text-center text-gray-400">
                                                <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                                <p className="text-sm font-medium text-gray-300">No results found</p>
                                                <p className="text-xs mt-1 text-gray-500">Try different keywords</p>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Section: Notifications + Auth */}
                        <div className="hidden md:flex items-center gap-2">
                            {/* Notifications */}
                            {isAuthenticated && !authLoading && <NotificationBell />}

                            {authLoading ? (
                                // Loading state - show skeleton instead of "Sign In" buttons
                                <div className="flex items-center gap-2">
                                    <div className="w-20 h-8 bg-dark-100 rounded-lg animate-pulse" />
                                    <div className="w-8 h-8 bg-dark-100 rounded-lg animate-pulse" />
                                </div>
                            ) : isAuthenticated ? (
                                <div className="relative" ref={profileRef}>
                                    {/* Profile Button */}
                                    <button
                                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                                        className="flex items-center gap-2.5 px-3 py-1.5 bg-dark-100 hover:bg-dark-50 rounded-xl
                                               border border-gray-700/50 hover:border-accent/50 transition-all duration-200 group ml-2"
                                    >
                                        {/* Avatar */}
                                        <div className="w-8 h-8 rounded-lg overflow-hidden border-2 border-transparent group-hover:border-accent/50 transition-colors">
                                            {user?.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                                    <User className="w-4 h-4 text-white" />
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors max-w-[100px] truncate">
                                            {user?.username}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {/* Enhanced Dropdown Menu */}
                                    {isProfileOpen && (
                                        <div className="absolute right-0 top-full mt-2 w-72 py-2 bg-dark-100/95 backdrop-blur-xl 
                                                    rounded-xl border border-gray-700/50 shadow-xl shadow-black/20 animate-fade-in">
                                            {/* User Info Header */}
                                            <div className="px-4 py-3 border-b border-gray-700/50">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-accent/30">
                                                        {user?.avatar ? (
                                                            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                                                <User className="w-5 h-5 text-white" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-white truncate">{user?.username}</p>
                                                        <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* User Stats */}
                                            <div className="px-4 py-3 border-b border-gray-700/50">
                                                <div className="grid grid-cols-3 gap-2 text-center">
                                                    <div className="p-2 bg-dark-50/50 rounded-lg">
                                                        <p className="text-lg font-bold text-white">{userStats.animeWatched}</p>
                                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Anime</p>
                                                    </div>
                                                    <div className="p-2 bg-dark-50/50 rounded-lg">
                                                        <p className="text-lg font-bold text-white">{userStats.episodesWatched}</p>
                                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Episodes</p>
                                                    </div>
                                                    <div className="p-2 bg-dark-50/50 rounded-lg">
                                                        <p className="text-lg font-bold text-white">{formatHours(userStats.hoursWatched)}h</p>
                                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Hours</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Menu Items */}
                                            <div className="py-1">
                                                <Link
                                                    to="/profile"
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white 
                                                           hover:bg-accent/10 transition-colors"
                                                >
                                                    <User className="w-4 h-4" />
                                                    <span className="text-sm font-medium">Profile</span>
                                                </Link>
                                                <Link
                                                    to="/settings"
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-white 
                                                           hover:bg-accent/10 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    </svg>
                                                    <span className="text-sm font-medium">Settings</span>
                                                </Link>
                                                <div className="border-t border-gray-700/50 my-1" />
                                                <button
                                                    onClick={() => { logout(); setIsProfileOpen(false); }}
                                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:text-red-400 
                                                           hover:bg-red-500/10 transition-colors"
                                                >
                                                    <LogOut className="w-4 h-4" />
                                                    <span className="text-sm font-medium">Sign Out</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <Link to="/login" className="text-gray-300 hover:text-white transition-colors font-medium px-3 py-2">
                                        Sign In
                                    </Link>
                                    <Link to="/register" className="btn-primary text-sm py-2 px-4">
                                        Get Started
                                    </Link>
                                </>
                            )}
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="md:hidden p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                        >
                            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu - Enhanced */}
                {isMenuOpen && (
                    <div className="md:hidden bg-dark-100 border-t border-gray-800 max-h-[calc(100vh-4rem)] overflow-y-auto">
                        <div className="px-4 py-4 space-y-4">
                            {/* Mobile Search with Fuzzy */}
                            <form onSubmit={handleSearch} className="relative">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search anime..."
                                    className="w-full pl-11 pr-4 py-3 bg-dark-50 border border-gray-700 rounded-xl text-sm text-white
                                     placeholder:text-gray-400 focus:outline-none focus:border-accent transition-all"
                                />
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            </form>

                            {/* Mobile Search Suggestions */}
                            {searchSuggestions.length > 0 && searchQuery.trim().length >= 1 && (
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {searchSuggestions.slice(0, 5).map((anime) => (
                                        <button
                                            key={anime.id}
                                            onClick={() => {
                                                handleSuggestionClick(anime.slug);
                                                setIsMenuOpen(false);
                                            }}
                                            className="w-full flex items-center gap-3 p-2 hover:bg-dark-50 rounded-lg transition-colors text-left"
                                        >
                                            <img
                                                src={anime.cover_image}
                                                alt={anime.title}
                                                className="w-8 h-12 object-cover rounded-lg flex-shrink-0"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-medium text-white line-clamp-1">{anime.title}</h4>
                                                <p className="text-xs text-gray-400">{anime.anime_type}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Mobile Nav Links */}
                            <div className="space-y-1">
                                <Link
                                    to="/browse"
                                    className={`flex items-center gap-3 py-3 px-3 rounded-xl transition-colors ${location.pathname === '/browse'
                                        ? 'bg-accent/10 text-white'
                                        : 'text-gray-300 hover:text-white hover:bg-dark-50'
                                        }`}
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    <Search className="w-5 h-5" />
                                    Browse
                                </Link>
                                <Link
                                    to="/seasonal"
                                    className={`flex items-center gap-3 py-3 px-3 rounded-xl transition-colors ${location.pathname === '/seasonal'
                                        ? 'bg-accent/10 text-white'
                                        : 'text-gray-300 hover:text-white hover:bg-dark-50'
                                        }`}
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    <Calendar className="w-5 h-5" />
                                    Seasonal
                                </Link>
                                <Link
                                    to="/schedule"
                                    className={`flex items-center gap-3 py-3 px-3 rounded-xl transition-colors ${location.pathname === '/schedule'
                                        ? 'bg-accent/10 text-white'
                                        : 'text-gray-300 hover:text-white hover:bg-dark-50'
                                        }`}
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    <Tv className="w-5 h-5" />
                                    Schedule
                                </Link>
                                {(isAuthenticated || authLoading) && (
                                    <Link
                                        to="/profile"
                                        className={`flex items-center gap-3 py-3 px-3 rounded-xl transition-colors ${location.pathname === '/profile'
                                            ? 'bg-accent/10 text-white'
                                            : 'text-gray-300 hover:text-white hover:bg-dark-50'
                                            }`}
                                        onClick={() => setIsMenuOpen(false)}
                                    >
                                        <Heart className="w-5 h-5" />
                                        My List
                                    </Link>
                                )}
                            </div>

                            {authLoading ? (
                                // Loading state for mobile
                                <div className="space-y-2 pt-4 border-t border-gray-700/50">
                                    <div className="flex items-center gap-3 py-3 px-3">
                                        <div className="w-12 h-12 rounded-xl bg-dark-50 animate-pulse" />
                                        <div className="space-y-2">
                                            <div className="w-24 h-4 bg-dark-50 rounded animate-pulse" />
                                            <div className="w-32 h-3 bg-dark-50 rounded animate-pulse" />
                                        </div>
                                    </div>
                                </div>
                            ) : isAuthenticated ? (
                                <div className="space-y-1 pt-4 border-t border-gray-700/50">
                                    {/* Mobile Profile Header with Stats */}
                                    <Link to="/profile" className="flex items-center gap-3 py-3 px-3 hover:bg-dark-50 rounded-xl transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        <div className="w-12 h-12 rounded-xl overflow-hidden border-2 border-accent/30 shrink-0">
                                            {user?.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                                    <User className="w-6 h-6 text-white" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-white">{user?.username}</p>
                                            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                                        </div>
                                    </Link>

                                    {/* Mobile User Stats */}
                                    <div className="grid grid-cols-3 gap-2 px-3 py-2">
                                        <div className="text-center p-2 bg-dark-50 rounded-lg">
                                            <p className="text-base font-bold text-white">{userStats.animeWatched}</p>
                                            <p className="text-[10px] text-gray-500">Anime</p>
                                        </div>
                                        <div className="text-center p-2 bg-dark-50 rounded-lg">
                                            <p className="text-base font-bold text-white">{userStats.episodesWatched}</p>
                                            <p className="text-[10px] text-gray-500">Eps</p>
                                        </div>
                                        <div className="text-center p-2 bg-dark-50 rounded-lg">
                                            <p className="text-base font-bold text-white">{formatHours(userStats.hoursWatched)}h</p>
                                            <p className="text-[10px] text-gray-500">Hours</p>
                                        </div>
                                    </div>

                                    <Link to="/settings" className="flex items-center gap-3 py-3 px-3 text-gray-300 hover:text-white hover:bg-dark-50 rounded-xl transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        Settings
                                    </Link>
                                    <button onClick={() => { logout(); setIsMenuOpen(false); }} className="w-full flex items-center gap-3 py-3 px-3 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors">
                                        <LogOut className="w-5 h-5" />
                                        Sign Out
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2 pt-4 border-t border-gray-700/50">
                                    <Link to="/login" className="flex items-center gap-3 py-3 px-3 text-gray-300 hover:text-white hover:bg-dark-50 rounded-xl transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        <LogOut className="w-5 h-5 rotate-180" />
                                        Sign In
                                    </Link>
                                    <Link to="/register" className="flex items-center justify-center gap-2 py-3 px-3 bg-accent text-dark font-semibold rounded-xl hover:bg-accent/90 transition-colors" onClick={() => setIsMenuOpen(false)}>
                                        Get Started
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </nav>
        </>
    );
}
