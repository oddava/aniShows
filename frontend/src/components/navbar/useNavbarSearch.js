import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isActiveElementEditable } from '../../utils/dom';
import useAnimeSearchSuggestions, { MIN_SEARCH_LENGTH } from './useAnimeSearchSuggestions';

const MAX_SUGGESTIONS = 8;

/**
 * State and behaviour of the desktop navbar search: the collapsible input,
 * server-side suggestions (useAnimeSearchSuggestions), keyboard shortcuts ("/",
 * Escape, arrows, Enter) and closing on outside clicks. Navbar calls it so the
 * auto-hide logic can see whether the search is in use. (Navbar also passes
 * `{ setIsProfileOpen }`; the profile menu handles its own Escape, so it is
 * not needed here.)
 */
export default function useNavbarSearch() {
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const navigate = useNavigate();
    const searchRef = useRef(null);
    const searchInputRef = useRef(null);

    const suggestions = useAnimeSearchSuggestions(searchQuery);
    const searchSuggestions = suggestions.isActive
        ? suggestions.results.slice(0, MAX_SUGGESTIONS)
        : suggestions.results;
    const isSearching = suggestions.isSearching;

    // Typing opens the list; a query too short to search closes it. Dismissing
    // (Escape, outside click) doesn't change the query, so a late response
    // never reopens the list by itself.
    useEffect(() => {
        setSelectedIndex(-1);
        setShowSuggestions(searchQuery.trim().length >= MIN_SEARCH_LENGTH);
    }, [searchQuery]);

    const closeSearch = useCallback(() => {
        setShowSuggestions(false);
        setSelectedIndex(-1);
        setIsSearchExpanded(false);
    }, []);

    // Close the suggestions when clicking outside the search
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                closeSearch();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeSearch]);

    const leaveSearch = useCallback((path) => {
        navigate(path);
        setSearchQuery('');
        closeSearch();
        searchInputRef.current?.blur();
    }, [navigate, closeSearch]);

    const handleSuggestionClick = useCallback((slug) => {
        leaveSearch(`/anime/${slug}`);
    }, [leaveSearch]);

    // Keyboard shortcuts
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
                // A leftover query is selected, so typing replaces it.
                searchInputRef.current.select();
                if (searchInputRef.current.value.trim().length >= MIN_SEARCH_LENGTH) setShowSuggestions(true);
            }

            // ESC to blur search and close dropdowns
            // (The profile menu handles its own Escape so it can restore focus
            // to its button.)
            if (e.key === 'Escape') {
                if (document.activeElement === searchInputRef.current) {
                    e.preventDefault();
                    searchInputRef.current.blur();
                }
                closeSearch();
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
    }, [showSuggestions, searchSuggestions, selectedIndex, handleSuggestionClick, closeSearch]);

    // Browse with the query ("View all results", "Search all anime", Enter).
    const handleSearch = (e) => {
        e?.preventDefault?.();
        const trimmed = searchQuery.trim();
        if (trimmed) {
            leaveSearch(`/browse?q=${encodeURIComponent(trimmed)}`);
        }
    };

    // Focus left the search widget (Tab, click elsewhere): close the list so
    // nothing reopens or captures keys later.
    const handleSearchBlur = useCallback((event) => {
        if (searchRef.current?.contains(event.relatedTarget)) return;
        setShowSuggestions(false);
        setSelectedIndex(-1);
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
        noMatches: suggestions.noMatches,
        showSuggestions, setShowSuggestions,
        selectedIndex, setSelectedIndex,
        handleSuggestionClick,
        handleSearch,
    };
}
