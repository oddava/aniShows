import { Link, useNavigate, useLocation, NavLink } from 'react-router-dom';
import {
    User,
    Bell,
    Settings,
    LogOut,
    ChevronDown,
    Home,
    Clapperboard,
    MessageSquare,
    Compass,
    CalendarDays,
    Search,
} from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { animeApi, notificationApi } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';
import logger, { isRequestAbortError } from '../utils/logger';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getOptimizedImageUrl,
} from '../utils/imageUtils';

import Fuse from 'fuse.js';
import Logo from './Logo';

// Navigation Item Component with Active State
const NavItem = ({ to, label, end = false }) => {
    return (
        <NavLink
            to={to}
            end={end}
            title={label}
            className={({ isActive }) => `
                relative flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300
                ${isActive
                    ? 'text-white bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
            `}
        >
            <span className="tracking-wide">{label}</span>
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
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchSuggestions, setSearchSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [isMobileAccountOpen, setIsMobileAccountOpen] = useState(false);
    const [isMobileAnimeOpen, setIsMobileAnimeOpen] = useState(false);
    const [lastScrollY, setLastScrollY] = useState(0);
    const [allAnimeCache, setAllAnimeCache] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [mobileUnreadCount, setMobileUnreadCount] = useState(0);
    const { user, logout, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const profileRef = useRef(null);
    const searchRef = useRef(null);
    const searchInputRef = useRef(null);
    const mobileAccountRef = useRef(null);
    const mobileAnimeRef = useRef(null);
    const accountHoldTimerRef = useRef(null);
    const longPressTriggeredRef = useRef(false);

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
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setShowSuggestions(false);
                setSelectedIndex(-1);
                setIsSearchExpanded(false);
            }
            if (mobileAccountRef.current && !mobileAccountRef.current.contains(event.target)) {
                setIsMobileAccountOpen(false);
            }
            if (mobileAnimeRef.current && !mobileAnimeRef.current.contains(event.target)) {
                setIsMobileAnimeOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const fetchUnreadCount = async () => {
            if (!isAuthenticated) {
                setMobileUnreadCount(0);
                return;
            }

            try {
                const response = await notificationApi.getUnreadCount();
                setMobileUnreadCount(response.data?.count ?? 0);
            } catch (error) {
                logger.error('Failed to fetch mobile notification count:', error);
            }
        };

        fetchUnreadCount();
    }, [isAuthenticated]);

    useEffect(() => {
        if (location.pathname === '/notifications') {
            setMobileUnreadCount(0);
        }
    }, [location.pathname]);

    useEffect(() => {
        const handleUnreadCountEvent = (event) => {
            const nextCount = event?.detail?.count;
            if (typeof nextCount === 'number') {
                setMobileUnreadCount(nextCount);
            }
        };

        window.addEventListener('notifications:unread-count', handleUnreadCountEvent);
        return () => window.removeEventListener('notifications:unread-count', handleUnreadCountEvent);
    }, []);

    const handleNotificationMessage = useCallback((data) => {
        if (data.type === 'unread_count') {
            setMobileUnreadCount(data.count ?? 0);
            return;
        }
        if (data.type === 'notification' && data.unread_count != null) {
            setMobileUnreadCount(data.unread_count);
            return;
        }
        if (data.type === 'notification_read' && data.unread_count != null) {
            setMobileUnreadCount(data.unread_count);
        }
    }, []);

    useWebSocket(
        user ? '/ws/notifications/' : null,
        { onMessage: handleNotificationMessage },
        { autoConnect: !!user }
    );

    useEffect(() => {
        setIsMobileAccountOpen(false);
        setIsMobileAnimeOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        return () => {
            if (accountHoldTimerRef.current) {
                clearTimeout(accountHoldTimerRef.current);
            }
        };
    }, []);

    // Auto-hide navbar logic
    const isHoveredRef = useRef(false);
    const isSearchExpandedRef = useRef(isSearchExpanded);
    const isProfileOpenRef = useRef(isProfileOpen);
    const showSuggestionsRef = useRef(showSuggestions);
    const isSearchingRef = useRef(isSearching);
    const timeoutRef = useRef(null);

    // Keep refs fully in sync
    useEffect(() => { isSearchExpandedRef.current = isSearchExpanded; }, [isSearchExpanded]);
    useEffect(() => { isProfileOpenRef.current = isProfileOpen; }, [isProfileOpen]);
    useEffect(() => { showSuggestionsRef.current = showSuggestions; }, [showSuggestions]);
    useEffect(() => { isSearchingRef.current = isSearching; }, [isSearching]);

    const startHideTimer = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            const isInteracting = 
                isHoveredRef.current || 
                isSearchExpandedRef.current || 
                isProfileOpenRef.current || 
                showSuggestionsRef.current || 
                isSearchingRef.current;
                
            if (!isInteracting) {
                setIsVisible(false);
            }
        }, 1500); // Hide after 1.5 seconds of idle time
    }, []);

    // Watch for interactions closing to resume hide timer
    useEffect(() => {
        if (!isSearchExpanded && !isProfileOpen && !showSuggestions) {
            if (!isHoveredRef.current && isVisible) {
                startHideTimer();
            }
        }
    }, [isSearchExpanded, isProfileOpen, showSuggestions, isVisible, startHideTimer]);

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            // Show on scroll
            if (currentScrollY < 100) {
                setIsVisible(true);
                startHideTimer();
            } else if (currentScrollY > lastScrollY && currentScrollY > 200) {
                if (!isHoveredRef.current && !isSearchExpandedRef.current && !isProfileOpenRef.current && !showSuggestionsRef.current) {
                    setIsVisible(false);
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                }
            } else if (currentScrollY < lastScrollY) {
                setIsVisible(true);
                startHideTimer();
            }

            setLastScrollY(currentScrollY);
        };

        const handleMouseMove = (e) => {
            const isTopArea = e.clientY <= 90;
            
            if (isTopArea && !isHoveredRef.current) {
                isHoveredRef.current = true;
                setIsVisible(true);
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
            } else if (!isTopArea && isHoveredRef.current) {
                isHoveredRef.current = false;
                startHideTimer();
            }
        };

        // Initialize state listener
        startHideTimer();

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('mousemove', handleMouseMove);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [lastScrollY, startHideTimer]);

    // Define handleSuggestionClick BEFORE the useEffect that uses it
    const handleSuggestionClick = useCallback((slug) => {
        navigate(`/anime/${slug}`);
        setSearchQuery('');
        setShowSuggestions(false);
        setSelectedIndex(-1);
        setIsSearchExpanded(false);
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
                setIsSearchExpanded(true);
                setTimeout(() => {
                    if (searchInputRef.current) {
                        searchInputRef.current.focus();
                        setShowSuggestions(true);
                    }
                }, 50);
            }

            // ESC to blur search and close dropdowns
            if (e.key === 'Escape') {
                if (document.activeElement === searchInputRef.current) {
                    e.preventDefault();
                    searchInputRef.current.blur();
                    setShowSuggestions(false);
                    setSelectedIndex(-1);
                    setIsSearchExpanded(false);
                } else {
                    setShowSuggestions(false);
                    setIsProfileOpen(false);
                    setIsSearchExpanded(false);
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
            setIsSearchExpanded(false);
            if (searchInputRef.current) {
                searchInputRef.current.blur();
            }
        }
    };

    const currentUserProfilePath = user?.username ? `/u/${user.username}` : '/profile';
    const isProfileRoute = location.pathname === '/profile'
        || location.pathname.startsWith('/profile/')
        || location.pathname.startsWith('/u/');
    const isOnCurrentUserProfile = Boolean(user?.username) && (
        location.pathname === currentUserProfilePath
        || location.pathname.startsWith(`${currentUserProfilePath}/`)
    );
    const mobileProfilePath = isAuthenticated ? currentUserProfilePath : '/login';
    const mobileProfileLabel = isAuthenticated ? 'Profile' : 'Sign In';

    const showMobileIsland = useMemo(() => {
        const mainPaths = ['/', '/browse', '/schedule', '/forums', '/profile', '/u', '/settings', '/notifications'];
        return mainPaths.some((path) => {
            if (path === '/') return location.pathname === '/';
            return location.pathname === path || location.pathname.startsWith(`${path}/`);
        });
    }, [location.pathname]);

    const isPathActive = (path) => {
        if (path === '/browse' || path === '/schedule') {
            return location.pathname === path;
        }
        return location.pathname.startsWith(path);
    };

    const mobileTabClasses = (isActive) => `
        group relative min-w-0 flex h-12 flex-col items-center justify-center rounded-xl border border-transparent px-0.5 transition-colors duration-200 outline-none
        focus:outline-none focus-visible:outline-none focus-visible:ring-0 [-webkit-tap-highlight-color:transparent]
        ${isActive
            ? 'border-accent/35 bg-accent/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
            : 'text-gray-300/90 hover:bg-white/[0.08] hover:text-white active:bg-white/[0.06]'
        }
    `;

    const mobileIslandBackground = 'var(--color-surface-glass)';
    const mobilePopoverBackground = 'color-mix(in srgb, var(--color-dark-50) 94%, transparent)';
    const mobilePopoverTipBackground = 'color-mix(in srgb, var(--color-dark-50) 94%, transparent)';

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
            if (!isOnCurrentUserProfile) {
                navigate(currentUserProfilePath);
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
                className={`hidden md:block fixed top-4 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-2rem)] max-w-6xl rounded-2xl border border-white/10 bg-dark/70 backdrop-blur-xl transition-all duration-300 ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0 pointer-events-none'}`}
                style={{
                    background: 'var(--color-navbar-bg)',
                    borderColor: 'var(--color-navbar-border)',
                }}
            >
                <div className="px-4 sm:px-6">
                    <div className="flex items-center justify-between h-14">
                        {/* Logo */}
                        <Link to="/" className="focus:outline-none">
                            <Logo />
                        </Link>

                        {/* Desktop Nav */}
                        <div className="hidden md:flex items-center gap-1.5 flex-1 ml-6 lg:ml-8">
                            <NavItem to="/browse" label="Browse" />
                            <NavItem to="/schedule" label="Schedule" />
                            <NavItem to="/forums" label="Forums" />
                            {(isAuthenticated || authLoading) && (
                                <NavItem to={currentUserProfilePath} label="My List" />
                            )}

                            {/* Search - Collapsible */}
                            <div className="flex-1 flex justify-end mx-2 lg:mx-4" ref={searchRef}>
                                <div className={`relative transition-all duration-[400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${isSearchExpanded ? 'w-full max-w-[16rem] lg:max-w-[22rem]' : 'w-10'}`}>
                                    <form onSubmit={handleSearch} className="relative group/search flex items-center justify-end w-full h-full">
                                        {/* Search Icon / Toggle Button */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!isSearchExpanded) {
                                                    setIsSearchExpanded(true);
                                                    setTimeout(() => searchInputRef.current?.focus(), 50);
                                                }
                                            }}
                                            className={`absolute left-0 z-10 flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-0 outline-none ${isSearchExpanded ? 'h-[36px] w-[36px] pointer-events-none' : 'w-10 h-10 rounded-full hover:bg-white/10 cursor-pointer pointer-events-auto'}`}
                                            aria-label="Toggle Search"
                                        >
                                            <Search className={`w-4 h-4 transition-colors duration-300 ${isSearchExpanded ? 'text-gray-500 group-focus-within/search:text-accent' : 'text-gray-300 hover:text-white'}`} />
                                        </button>

                                        {/* Input */}
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
                                            className={`w-full rounded-full border border-white/5 bg-dark-100 py-2 pl-10 pr-8 text-sm text-white placeholder:text-gray-500 transition-all duration-[400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] focus:border-accent/40 focus:bg-dark-100 focus:outline-none focus:ring-4 focus:ring-accent/20 ${isSearchExpanded ? 'opacity-100 scale-x-100 pointer-events-auto origin-right' : 'opacity-0 scale-x-75 pointer-events-none border-transparent bg-transparent origin-right'}`}
                                        />

                                        {/* Clear button */}
                                        {searchQuery && isSearchExpanded && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSearchQuery('');
                                                    setShowSuggestions(false);
                                                    setSelectedIndex(-1);
                                                    searchInputRef.current?.focus();
                                                }}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none"
                                            >
                                                <span className="text-[10px] font-bold">CLEAR</span>
                                            </button>
                                        )}

                                        {/* Keyboard shortcut hint */}
                                        {!searchQuery && isSearchExpanded && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 pointer-events-none">
                                                <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono text-[10px] text-gray-400 border border-white/10">/</kbd>
                                            </div>
                                        )}
                                    </form>

                                    {/* Enhanced Search Suggestions Dropdown - Always visible when active */}
                                    <div
                                        className={`absolute left-0 right-0 top-full z-50 mt-3 max-h-[70vh] overflow-y-auto overflow-hidden rounded-2xl border border-white/10 bg-dark-100 shadow-2xl transition-all duration-300 origin-top ${showSuggestions ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95'
                                            }`}
                                    >
                                        {isSearching && searchSuggestions.length === 0 ? (
                                            // Loading state - show previous results or skeleton
                                            <div className="py-6 text-center text-gray-400">
                                                <div className="w-6 h-6 mx-auto mb-2 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                                <p className="text-sm">Searching...</p>
                                            </div>
                                        ) : searchSuggestions.length > 0 ? (
                                            <>
                                                {searchSuggestions.map((anime, index) => {
                                                    const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
                                                    const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');

                                                    return (
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
                                                                src={imageUrl}
                                                                alt={anime.title}
                                                                onError={(event) => applyImageFallback(event, fallbackImageUrl)}
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
                                                                    <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-tighter">Rating</span>
                                                                    <span className="text-xs font-semibold text-yellow-500">{anime.rating}</span>
                                                                </div>
                                                            )}
                                                            {anime.isExactMatch && (
                                                                <span className="text-[10px] px-1.5 py-0.5 bg-accent/20 text-accent rounded-full flex-shrink-0">
                                                                    Exact
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}

                                                <button
                                                    onClick={handleSearch}
                                                    className="w-full py-3 px-4 text-center text-sm font-medium text-accent hover:bg-dark-50 transition-colors border-t border-gray-700/50 flex items-center justify-center gap-2"
                                                >
                                                    View all results for "{searchQuery}"
                                                </button>
                                            </>
                                        ) : searchQuery.trim().length >= 2 ? (
                                            <div className="py-8 text-center text-gray-400">
                                                <p className="text-sm font-medium text-gray-300">No results found</p>
                                                <p className="text-xs mt-1 text-gray-500">Try different keywords</p>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Section: Auth */}
                        <div className="hidden md:flex items-center gap-3">
                            {authLoading ? (
                                // Loading state - show skeleton instead of "Sign In" buttons
                                <div className="flex items-center gap-2">
                                    <div className="w-20 h-9 bg-white/5 rounded-xl animate-pulse" />
                                    <div className="w-9 h-9 bg-white/5 rounded-full animate-pulse" />
                                </div>
                            ) : isAuthenticated ? (
                                <div className="relative" ref={profileRef}>
                                    {/* Profile Button */}
                                    <button
                                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                                        className="relative group flex items-center gap-3 rounded-full border border-white/5 bg-black/20 pl-1.5 pr-4 py-1 transition-all duration-300 hover:border-white/10 hover:bg-black/40 hover:shadow-[0_0_20px_rgba(117,105,141,0.12)] focus:outline-none focus:ring-2 focus:ring-accent/30"
                                    >
                                        {/* Avatar or Placeholder */}
                                        <div className="w-7 h-7 rounded-full overflow-hidden border border-transparent group-hover:border-white/20 transition-all duration-300">
                                            {user?.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-accent flex items-center justify-center">
                                                    <span className="text-sm font-bold text-white uppercase">{user?.username?.charAt(0)}</span>
                                                </div>
                                            )}
                                        </div>
                                        {isAuthenticated && mobileUnreadCount > 0 && (
                                            <span className="absolute top-1 left-7 w-2h-2 bg-red-500 rounded-full ring-2 ring-dark shadow-sm z-10" />
                                        )}
                                        <span className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors max-w-[100px] truncate">
                                            {user?.username}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 text-gray-400 group-hover:text-white transition-all duration-300 ${isProfileOpen ? 'rotate-180 text-white' : ''}`} />
                                    </button>

                                    {/* Enhanced Dropdown Menu */}
                                    {isProfileOpen && (
                                        <div className="absolute right-0 top-full mt-4 w-72 py-2 rounded-2xl border border-white/10 bg-dark/95 backdrop-blur-xl shadow-2xl origin-top-right animate-in fade-in zoom-in-95 duration-200 z-[1001]">
                                            {/* User Info Header */}
                                            <div className="px-4 py-3 border-b border-white/10 bg-white/5 mx-2 rounded-xl mb-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 shadow-sm">
                                                        {user?.avatar ? (
                                                            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full bg-accent flex items-center justify-center">
                                                                <span className="text-xl font-bold text-white uppercase">{user?.username?.charAt(0)}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-white truncate drop-shadow-sm">{user?.username}</p>
                                                        <p className="text-xs text-gray-400/80 truncate">{user?.email}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Menu Items */}
                                            <div className="py-1 px-2 space-y-0.5">
                                                <Link
                                                    to={currentUserProfilePath}
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none group"
                                                >
                                                    <User className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                                    <span className="text-sm font-medium">Profile</span>
                                                </Link>
                                                <Link
                                                    to="/notifications"
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none group"
                                                >
                                                    <span className="flex items-center gap-3 min-w-0">
                                                        <Bell className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                                        <span className="text-sm font-medium">Notifications</span>
                                                    </span>
                                                    {mobileUnreadCount > 0 && (
                                                        <span
                                                            className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_0_2px_rgba(17,24,39,1)]"
                                                            aria-label="New notifications"
                                                        />
                                                    )}
                                                </Link>
                                                <Link
                                                    to="/settings"
                                                    onClick={() => setIsProfileOpen(false)}
                                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none group"
                                                >
                                                    <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform" />
                                                    <span className="text-sm font-medium">Settings</span>
                                                </Link>
                                                <div className="border-t border-white/10 my-2 mx-2" />
                                                <button
                                                    onClick={() => { logout(); setIsProfileOpen(false); }}
                                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 transition-all duration-200 hover:bg-red-500/15 hover:text-red-400 focus:outline-none group"
                                                >
                                                    <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
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
                    className="md:hidden fixed bottom-[max(0.4rem,env(safe-area-inset-bottom))] inset-x-[0.45rem] z-[1001] mx-auto w-auto max-w-[350px] select-none"
                    style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                >
                    <div
                        className="rounded-[1.45rem] border border-white/12 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150"
                        style={{ background: mobileIslandBackground }}
                    >
                        <div className="grid grid-cols-5 gap-0.5">
                            <Link
                                to="/"
                                className={mobileTabClasses(location.pathname === '/')}
                            >
                                <Home className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]">Home</span>
                            </Link>
                            <div className="relative min-w-0" ref={mobileAnimeRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsMobileAnimeOpen((prev) => !prev)}
                                    className={`w-full ${mobileTabClasses(isPathActive('/browse') || isPathActive('/schedule'))}`}
                                >
                                    <Clapperboard className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                    <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]">Anime</span>
                                </button>
                                {isMobileAnimeOpen && (
                                    <div
                                        className="absolute bottom-full left-0 mb-2.5 w-36 overflow-hidden rounded-xl border border-white/12 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                                        style={{ background: mobilePopoverBackground }}
                                    >
                                        <div
                                            className="absolute -bottom-1.5 left-4 h-3 w-3 rotate-45 border-r border-b border-white/12"
                                            style={{ backgroundColor: mobilePopoverTipBackground }}
                                        />
                                        <Link
                                            to="/browse"
                                            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/10"
                                        >
                                            <Compass className="h-3.5 w-3.5 text-gray-300" />
                                            Browse
                                        </Link>
                                        <Link
                                            to="/schedule"
                                            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/10"
                                        >
                                            <CalendarDays className="h-3.5 w-3.5 text-gray-300" />
                                            Schedule
                                        </Link>
                                    </div>
                                )}
                            </div>
                            <Link
                                to="/forums"
                                className={mobileTabClasses(isPathActive('/forums'))}
                            >
                                <MessageSquare className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]">Forums</span>
                            </Link>
                            <Link
                                to="/notifications"
                                className={mobileTabClasses(isPathActive('/notifications'))}
                            >
                                <span className="relative inline-flex">
                                    {isAuthenticated && mobileUnreadCount > 0 && (
                                        <span className="absolute -right-2 -top-2 z-10 h-[13px] min-w-[13px] rounded-full bg-red-500 px-1 text-center text-[8px] font-semibold leading-[13px] text-white">
                                            {mobileUnreadCount > 9 ? '9+' : mobileUnreadCount}
                                        </span>
                                    )}
                                    <Bell className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                </span>
                                <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]">Notifs</span>
                            </Link>
                            <div className="relative min-w-0" ref={mobileAccountRef}>
                                {isAuthenticated ? (
                                    <>
                                        <button
                                            type="button"
                                            onPointerDown={startAccountHold}
                                            onPointerUp={endAccountHold}
                                            onPointerLeave={cancelAccountHold}
                                            onPointerCancel={cancelAccountHold}
                                            onContextMenu={(e) => e.preventDefault()}
                                            className={`w-full ${mobileTabClasses(isProfileRoute || isPathActive('/settings'))}`}
                                        >
                                            {user?.avatar ? (
                                                <img
                                                    src={user.avatar}
                                                    alt={user.username}
                                                    className="h-3.5 w-3.5 rounded-full object-cover ring-1 ring-white/15"
                                                />
                                            ) : (
                                                <User className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                            )}
                                            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]">Account</span>
                                        </button>
                                        {isMobileAccountOpen && (
                                            <div
                                                className="absolute bottom-full right-0 mb-2.5 w-36 overflow-hidden rounded-xl border border-white/12 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                                                style={{ background: mobilePopoverBackground }}
                                            >
                                                <div
                                                    className="absolute -bottom-1.5 right-4 h-3 w-3 rotate-45 border-r border-b border-white/12"
                                                    style={{ backgroundColor: mobilePopoverTipBackground }}
                                                />
                                                {!isOnCurrentUserProfile && (
                                                    <Link
                                                        to={currentUserProfilePath}
                                                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/10"
                                                    >
                                                        Profile
                                                    </Link>
                                                )}
                                                {!isPathActive('/settings') && (
                                                    <Link
                                                        to="/settings"
                                                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/10"
                                                    >
                                                        Settings
                                                    </Link>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        logout();
                                                        setIsMobileAccountOpen(false);
                                                    }}
                                                    className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-red-300 hover:bg-red-500/15"
                                                >
                                                    Sign Out
                                                </button>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <Link
                                        to={mobileProfilePath}
                                        className={mobileTabClasses(location.pathname === '/login' || location.pathname === '/register')}
                                    >
                                        <User className="h-[0.95rem] w-[0.95rem] stroke-[1.9]" />
                                        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]">{mobileProfileLabel}</span>
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
