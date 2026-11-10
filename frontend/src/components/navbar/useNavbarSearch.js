import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { navbarSearchKeys, navbarSearchQueries } from '../../api/queries/anime';
import { useFreshError, useReportError } from '../../hooks/useQueryErrorReport';
import logger from '../../utils/logger';
import { isActiveElementEditable } from '../../utils/dom';
import useFuzzySearch from './useFuzzySearch';

const EMPTY_ANIME_CACHE = [];

/**
 * State and behaviour of the desktop navbar search: the collapsible input,
 * local fuzzy matches plus API results (debounced), keyboard shortcuts ("/",
 * Escape, arrows, Enter) and closing on outside clicks. Navbar calls it so the
 * auto-hide logic can see whether the search is in use; Escape also closes the
 * profile menu, hence `setIsProfileOpen`.
 */
export default function useNavbarSearch({ setIsProfileOpen }) {
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchSuggestions, setSearchSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [FuseClass, setFuseClass] = useState(null);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const searchRef = useRef(null);
    const searchInputRef = useRef(null);

    // The first 100 titles, matched locally for instant suggestions. Loaded once
    // per mount; a failure only costs the local matches.
    const animeCacheQuery = useQuery({ ...navbarSearchQueries.cache(), staleTime: 0, retry: false });
    const allAnimeCache = animeCacheQuery.data ?? EMPTY_ANIME_CACHE;
    useReportError(
        useFreshError(animeCacheQuery, navbarSearchKeys.cache()),
        animeCacheQuery.errorUpdatedAt,
        { log: 'Failed to load anime cache:' },
    );

    // Initialize fuzzy search with cache - options are now inside the hook
    const { search: fuzzySearch } = useFuzzySearch(FuseClass, allAnimeCache, {});

    // fuse.js only powers the search box, so keep it out of the entry chunk.
    useEffect(() => {
        let active = true;
        import('fuse.js')
            .then((module) => {
                if (active) {
                    setFuseClass(() => module.default);
                }
            })
            .catch((error) => logger.error('Failed to load fuzzy search:', error));
        return () => {
            active = false;
        };
    }, []);

    // Close the suggestions when clicking outside the search
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setShowSuggestions(false);
                setSelectedIndex(-1);
                setIsSearchExpanded(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
                if (isActiveElementEditable()) {
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
    }, [showSuggestions, searchSuggestions, selectedIndex, handleSuggestionClick, navigate, setIsProfileOpen]);

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
                    const results = await queryClient.fetchQuery({
                        ...navbarSearchQueries.results(searchQuery.trim()),
                        retry: false,
                    });
                    apiResults = results.map(item => ({
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
    }, [searchQuery, queryClient]);

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

    return {
        searchRef,
        searchInputRef,
        isSearchExpanded, setIsSearchExpanded,
        searchQuery, setSearchQuery,
        searchSuggestions,
        isSearching,
        showSuggestions, setShowSuggestions,
        selectedIndex, setSelectedIndex,
        handleSuggestionClick,
        handleSearch,
    };
}
