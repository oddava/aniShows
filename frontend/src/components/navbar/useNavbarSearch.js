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
    // Generation counter: results are applied only if no newer search started
    // and the dropdown wasn't dismissed while the request was in flight.
    const requestIdRef = useRef(0);

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
                requestIdRef.current += 1; // drop any in-flight results
                setIsSearching(false);
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
        requestIdRef.current += 1; // drop any in-flight results
        setIsSearching(false);
        if (searchInputRef.current) {
            searchInputRef.current.blur();
        }
    }, [navigate]);

    // Enhanced keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // "/" (outside text fields) or Ctrl/Cmd+K (anywhere) focuses search
            const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
            const isCommandK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key?.toLowerCase() === 'k';
            // Pages with their own search box (Browse) don't mount the nav input.
            if ((isSlash || isCommandK) && searchInputRef.current) {
                // "/" is a character; let it through when typing in a field
                if (isSlash && isActiveElementEditable()) {
                    return;
                }
                // Guest home: the hero search is on screen and the nav pill is hidden.
                const heroSearch = document.documentElement.dataset.heroSearch === 'visible'
                    ? document.getElementById('home-search')
                    : null;
                if (heroSearch) {
                    e.preventDefault();
                    heroSearch.focus();
                    return;
                }
                e.preventDefault();
                setIsSearchExpanded(true);
                // The input is always mounted, so focus now: keys typed right
                // after the shortcut land in the field instead of being lost.
                searchInputRef.current.focus();
                if (searchInputRef.current.value.trim()) setShowSuggestions(true);
            }

            // ESC to blur search and close dropdowns
            if (e.key === 'Escape') {
                if (document.activeElement === searchInputRef.current) {
                    e.preventDefault();
                    searchInputRef.current.blur();
                    setShowSuggestions(false);
                    setSelectedIndex(-1);
                    setIsSearchExpanded(false);
                    requestIdRef.current += 1; // drop any in-flight results
                    setIsSearching(false);
                } else {
                    // (The profile menu handles its own Escape so it can
                    // restore focus to its button.)
                    setShowSuggestions(false);
                    setIsSearchExpanded(false);
                    requestIdRef.current += 1; // drop any in-flight results
                    setIsSearching(false);
                }
            }

            // Arrow keys for navigation in suggestions, only while typing in
            // the search field (never steal keys from whatever has focus).
            if (showSuggestions && searchSuggestions.length > 0 && document.activeElement === searchInputRef.current) {
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
            requestIdRef.current += 1; // cleared: drop any in-flight results
            setSearchSuggestions([]);
            setShowSuggestions(false);
            setSelectedIndex(-1);
            setIsSearching(false);
            return;
        }

        // Don't hide results immediately - keep showing old results while searching
        loadingStartTimeRef.current = Date.now();
        setIsSearching(true);

        const requestId = ++requestIdRef.current;
        const isCurrent = () => requestIdRef.current === requestId;

        searchTimeoutRef.current = setTimeout(async () => {
            try {
                // Local fuzzy matches show straight away; API results merge in.
                const fuzzyResults = fuzzySearchRef.current(searchQuery.trim());
                if (fuzzyResults.length > 0 && isCurrent()) {
                    setSearchSuggestions(fuzzyResults.slice(0, 8).map((item) => ({ ...item, isFuzzyMatch: true })));
                    setShowSuggestions(true);
                }

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

                if (!isCurrent()) return;

                // Combine results: API first (full database), then unique fuzzy matches
                const seen = new Set();
                const combined = [];
                apiResults.forEach(item => {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        combined.push(item);
                    }
                });
                fuzzyResults.forEach(item => {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        combined.push({ ...item, isFuzzyMatch: true });
                    }
                });

                // An empty result waits out a short minimum so "No results"
                // doesn't flash while the person is still typing.
                const elapsed = Date.now() - loadingStartTimeRef.current;
                const remainingTime = combined.length > 0 ? 0 : Math.max(0, MIN_LOADING_TIME - elapsed);

                setTimeout(() => {
                    if (!isCurrent()) return;
                    setSearchSuggestions(combined.slice(0, 8));
                    setShowSuggestions(true);
                    setIsSearching(false);
                }, remainingTime);
            } catch (error) {
                logger.error('Search error:', error);
                if (!isCurrent()) return;
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
            requestIdRef.current += 1; // drop any in-flight results
            setIsSearching(false);
            if (searchInputRef.current) {
                searchInputRef.current.blur();
            }
        }
    };

    // Focus left the search widget (Tab, click elsewhere): close the list and
    // drop any in-flight results so nothing reopens or captures keys later.
    const handleSearchBlur = useCallback((event) => {
        if (searchRef.current?.contains(event.relatedTarget)) return;
        setShowSuggestions(false);
        setSelectedIndex(-1);
        requestIdRef.current += 1;
        setIsSearching(false);
        if (!searchInputRef.current?.value) setIsSearchExpanded(false);
    }, []);

    return {
        handleSearchBlur,
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
