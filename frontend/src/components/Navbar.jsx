import { Link, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { Search, X, User, LogOut, ChevronDown, Star, Loader2, Calendar, Heart, Tv, MessageSquare, Settings } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { animeApi } from '../api/client';
import { NotificationBell } from './NotificationBell';
import logger, { isRequestAbortError } from '../utils/logger';

import Fuse from 'fuse.js';
import Logo from './Logo';

// Navigation Item Component with Active State
const NavItem = ({ to, icon: Icon, label, end = false }) => {  // eslint-disable-line no-unused-vars
    return (
        <NavLink
            to={to}
            end={end}
            title={label}
            className={({ isActive }) => `
                flex items-center gap-2 rounded-lg px-2 lg:px-3 py-2 font-medium transition-colors border border-transparent
                ${isActive
                    ? 'bg-dark-50 text-white border-gray-700'
                    : 'text-gray-400 hover:bg-dark-100 hover:text-white'
                }
            `}
        >
            <Icon className="w-4 h-4" />
            <span className="text-sm hidden lg:inline">{label}</span>
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
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);  // eslint-disable-line no-unused-vars
    const [searchQuery, setSearchQuery] = useState('');
    const [searchSuggestions, setSearchSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [isMobileAccountOpen, setIsMobileAccountOpen] = useState(false);
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
    const mobileAccountRef = useRef(null);
    const accountHoldTimerRef = useRef(null);
    const longPressTriggeredRef = useRef(false);

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
        const controller = new AbortController();
        let active = true;

        const loadAllAnime = async () => {
            try {
                // Load first 100 anime for fuzzy search
                const response = await animeApi.getAll({ page_size: 100 }, controller.signal);
                if (active) {
                    setAllAnimeCache(response.data.results || []);
                }
            } catch (error) {
                if (isRequestAbortError(error)) {
                    return;
                }
                logger.error('Failed to load anime cache:', error);
            }
        };

        loadAllAnime();

        return () => {
            active = false;
            controller.abort();
        };
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
            if (mobileAccountRef.current && !mobileAccountRef.current.contains(event.target)) {
                setIsMobileAccountOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        setIsMobileAccountOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        return () => {
            if (accountHoldTimerRef.current) {
                clearTimeout(accountHoldTimerRef.current);
            }
        };
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
                if (searchInputRef.current) {
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
    }, [showSuggestions, searchSuggestions, selectedIndex, handleSuggestionClick, navigate]);

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
                    logger.error('API search error:', apiError);
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
                logger.error('Search error:', error);
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

    const mobileProfilePath = isAuthenticated ? '/profile' : '/login';
    const mobileProfileLabel = isAuthenticated ? 'Profile' : 'Sign In';

    const showMobileIsland = useMemo(() => {
        const mainPaths = ['/', '/browse', '/seasonal', '/schedule', '/forums', '/profile', '/settings'];
        return mainPaths.some((path) => {
            if (path === '/') return location.pathname === '/';
            return location.pathname === path || location.pathname.startsWith(`${path}/`);
        });
    }, [location.pathname]);

    const isPathActive = (path) => {
        if (path === '/browse' || path === '/seasonal' || path === '/schedule') {
            return location.pathname === path;
        }
        return location.pathname.startsWith(path);
    };

    const startAccountHold = () => {
        longPressTriggeredRef.current = false;
        if (accountHoldTimerRef.current) {
            clearTimeout(accountHoldTimerRef.current);
        }
        accountHoldTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            setIsMobileAccountOpen(true);
        }, 350);
    };

    const endAccountHold = () => {
        if (accountHoldTimerRef.current) {
            clearTimeout(accountHoldTimerRef.current);
            accountHoldTimerRef.current = null;
        }
        if (!longPressTriggeredRef.current) {
            setIsMobileAccountOpen(false);
            if (location.pathname !== '/profile') {
                navigate('/profile');
            }
        }
    };

    const cancelAccountHold = () => {
        if (accountHoldTimerRef.current) {
            clearTimeout(accountHoldTimerRef.current);
            accountHoldTimerRef.current = null;
        }
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
            <nav
                className={`hidden md:block fixed top-0 left-0 right-0 z-[1000] border-b border-gray-800 bg-dark/95 transition-transform duration-200 ${isVisible ? 'translate-y-0' : '-translate-y-full'}`}
            >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link to="/" className="focus:outline-none">
                        <Logo />
                    </Link>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center gap-1 flex-1 ml-4 lg:ml-6">
                        <NavItem to="/browse" icon={Search} label="Browse" />
                        <NavItem to="/seasonal" icon={Calendar} label="Seasonal" />
                        <NavItem to="/schedule" icon={Tv} label="Schedule" />
                        <NavItem to="/forums" icon={MessageSquare} label="Forums" />
                        {(isAuthenticated || authLoading) && (
                            <NavItem to="/profile" icon={Heart} label="My List" />
                        )}

                        {/* Search - Always Extended with Fuzzy Search */}
                        <div className="flex-1 flex justify-center mx-2 lg:mx-4" ref={searchRef}>
                            <div className="relative w-full max-w-sm lg:max-w-xl">
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
                                        className="w-full rounded-xl border border-gray-700 bg-dark-100 py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-gray-400 focus:border-accent focus:outline-none"
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
                                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-colors hover:bg-dark-50 hover:text-white focus:outline-none"
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
                                    className={`absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto overflow-hidden rounded-xl border border-gray-700 bg-dark-100 shadow-lg shadow-black/30 transition-opacity ${showSuggestions ? 'opacity-100' : 'pointer-events-none opacity-0'
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
                                                    className={`w-full flex items-center gap-3 border-l-2 p-3 text-left transition-colors ${selectedIndex === index
                                                        ? 'bg-accent/10 border-accent'
                                                        : 'border-transparent hover:bg-dark-50'
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
                                    className="group ml-2 flex items-center gap-2.5 rounded-xl border border-gray-700 bg-dark-100 px-3 py-1.5 transition-colors hover:border-gray-600 hover:bg-dark-50 focus:outline-none"
                                >
                                    {/* Avatar */}
                                    <div className="w-8 h-8 rounded-lg overflow-hidden border-2 border-transparent group-hover:border-gray-500 transition-colors">
                                        {user?.avatar ? (
                                            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-accent flex items-center justify-center">
                                                <User className="w-4 h-4 text-white" />
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors max-w-[100px] truncate">
                                        {user?.username}
                                    </span>
                                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Enhanced Dropdown Menu */}
                                {isProfileOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-72 py-2 rounded-xl border border-gray-700 bg-dark-100 shadow-lg shadow-black/30">
                                        {/* User Info Header */}
                                        <div className="px-4 py-3 border-b border-gray-700">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-gray-700">
                                                    {user?.avatar ? (
                                                        <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full bg-accent flex items-center justify-center">
                                                            <User className="w-5 h-5 text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-accent truncate">{user?.username}</p>
                                                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* User Stats */}
                                        <div className="px-4 py-3 border-b border-gray-700">
                                            <div className="grid grid-cols-3 gap-2 text-center">
                                                <div className="rounded-lg border border-gray-700 bg-dark-50 p-2">
                                                    <p className="text-lg font-bold text-accent">{userStats.animeWatched}</p>
                                                    <p className="text-[10px] text-gray-400 uppercase tracking-wider">Anime</p>
                                                </div>
                                                <div className="rounded-lg border border-gray-700 bg-dark-50 p-2">
                                                    <p className="text-lg font-bold text-accent">{userStats.episodesWatched}</p>
                                                    <p className="text-[10px] text-gray-400 uppercase tracking-wider">Episodes</p>
                                                </div>
                                                <div className="rounded-lg border border-gray-700 bg-dark-50 p-2">
                                                    <p className="text-lg font-bold text-accent">{formatHours(userStats.hoursWatched)}h</p>
                                                    <p className="text-[10px] text-gray-400 uppercase tracking-wider">Hours</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Menu Items */}
                                        <div className="py-1">
                                            <Link
                                                to="/profile"
                                                onClick={() => setIsProfileOpen(false)}
                                                className="flex items-center gap-3 px-4 py-2.5 text-gray-300 transition-colors hover:bg-dark-50 hover:text-white focus:outline-none"
                                            >
                                                <User className="w-4 h-4" />
                                                <span className="text-sm font-medium">Profile</span>
                                            </Link>
                                            <Link
                                                to="/settings"
                                                onClick={() => setIsProfileOpen(false)}
                                                className="flex items-center gap-3 px-4 py-2.5 text-gray-300 transition-colors hover:bg-dark-50 hover:text-white focus:outline-none"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                </svg>
                                                <span className="text-sm font-medium">Settings</span>
                                            </Link>
                                            <div className="border-t border-white/10 my-1" />
                                            <button
                                                onClick={() => { logout(); setIsProfileOpen(false); }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-300 transition-colors hover:bg-red-500/10 hover:text-red-400 focus:outline-none"
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
                                <Link to="/login" className="text-gray-300 hover:text-white transition-colors font-medium px-3 py-2 focus:outline-none">
                                    Sign In
                                </Link>
                                <Link to="/register" className="btn-primary text-sm py-2 px-4 focus:outline-none">
                                    Get Started
                                </Link>
                            </>
                        )}
                    </div>

                    <div className="md:hidden w-6" />
                </div>
            </div>
            </nav>

            {/* Mobile Bottom Navigation Island */}
            {showMobileIsland && (
                <div
                    className="md:hidden fixed bottom-3 left-1/2 z-[1001] -translate-x-1/2 w-[calc(100%-1rem)] max-w-sm select-none"
                    style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                >
                    <div className="rounded-[1.6rem] border border-white/10 bg-black/70 shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-xl px-1.5 py-1.5">
                    <div className="grid grid-cols-5 gap-1">
                        <Link
                            to="/browse"
                            className={`flex flex-col items-center justify-center rounded-xl py-1.5 transition-all ${isPathActive('/browse')
                                ? 'bg-white/12 text-white'
                                : 'text-gray-300/85'
                                }`}
                        >
                            <Search className="w-4 h-4" />
                            <span className="mt-0.5 text-[10px] font-medium">Browse</span>
                        </Link>
                        <Link
                            to="/seasonal"
                            className={`flex flex-col items-center justify-center rounded-xl py-1.5 transition-all ${isPathActive('/seasonal')
                                ? 'bg-white/12 text-white'
                                : 'text-gray-300/85'
                                }`}
                        >
                            <Calendar className="w-4 h-4" />
                            <span className="mt-0.5 text-[10px] font-medium">Seasonal</span>
                        </Link>
                        <Link
                            to="/schedule"
                            className={`flex flex-col items-center justify-center rounded-xl py-1.5 transition-all ${isPathActive('/schedule')
                                ? 'bg-white/12 text-white'
                                : 'text-gray-300/85'
                                }`}
                        >
                            <Tv className="w-4 h-4" />
                            <span className="mt-0.5 text-[10px] font-medium">Schedule</span>
                        </Link>
                        <Link
                            to="/forums"
                            className={`flex flex-col items-center justify-center rounded-xl py-1.5 transition-all ${isPathActive('/forums')
                                ? 'bg-white/12 text-white'
                                : 'text-gray-300/85'
                                }`}
                        >
                            <MessageSquare className="w-4 h-4" />
                            <span className="mt-0.5 text-[10px] font-medium">Forums</span>
                        </Link>
                        <div className="relative" ref={mobileAccountRef}>
                            {isAuthenticated ? (
                                <>
                                    <button
                                        type="button"
                                        onPointerDown={startAccountHold}
                                        onPointerUp={endAccountHold}
                                        onPointerLeave={cancelAccountHold}
                                        onPointerCancel={cancelAccountHold}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className={`w-full flex flex-col items-center justify-center rounded-xl py-1.5 transition-all ${isPathActive('/profile')
                                            ? 'bg-white/12 text-white'
                                            : 'text-gray-300/85'
                                            }`}
                                    >
                                        {user?.avatar ? (
                                            <img
                                                src={user.avatar}
                                                alt={user.username}
                                                className="w-4 h-4 rounded-full object-cover"
                                            />
                                        ) : (
                                            <User className="w-4 h-4" />
                                        )}
                                        <span className="mt-0.5 text-[10px] font-medium">Account</span>
                                    </button>
                                    {isMobileAccountOpen && (
                                        <div className="absolute bottom-full right-0 mb-3 w-36 rounded-2xl border border-white/10 bg-[#0a0d12] shadow-[0_8px_28px_rgba(0,0,0,0.5)] overflow-hidden">
                                            <div className="absolute -bottom-1.5 right-4 w-3 h-3 rotate-45 bg-[#0a0d12] border-r border-b border-white/10" />
                                            {!isPathActive('/profile') && (
                                                <Link
                                                    to="/profile"
                                                    className="flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-white/10"
                                                >
                                                    <User className="w-3.5 h-3.5" />
                                                    Profile
                                                </Link>
                                            )}
                                            {!isPathActive('/settings') && (
                                                <Link
                                                    to="/settings"
                                                    className="flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-white/10"
                                                >
                                                    <Settings className="w-3.5 h-3.5" />
                                                    Settings
                                                </Link>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    logout();
                                                    setIsMobileAccountOpen(false);
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-300 hover:bg-red-500/15"
                                            >
                                                <LogOut className="w-3.5 h-3.5" />
                                                Sign Out
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <Link
                                    to={mobileProfilePath}
                                    className={`flex flex-col items-center justify-center rounded-xl py-1.5 transition-all ${isPathActive('/login')
                                        ? 'bg-white/12 text-white'
                                        : 'text-gray-300/85'
                                        }`}
                                >
                                    <User className="w-4 h-4" />
                                    <span className="mt-0.5 text-[10px] font-medium">{mobileProfileLabel}</span>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
                </div>
            )}
        </>
    );
}
