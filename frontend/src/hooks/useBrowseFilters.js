import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Hook to manage browse filter state
 * Handles local filter state vs applied (URL) filter state
 */
export function useBrowseFilters() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);

    // Parse current filters from URL
    const currentFilters = useMemo(() => ({
        genres: searchParams.get('genre')?.split(',').filter(Boolean) || [],
        type: searchParams.get('type') || '',
        status: searchParams.get('status') || '',
        season: searchParams.get('season') || '',
        year: searchParams.get('year') || '',
        minRating: searchParams.get('min_rating') || '',
        maxRating: searchParams.get('max_rating') || '',
        studio: searchParams.get('studio') || '',
    }), [searchParams]);

    // Local filter state (not applied until Apply button clicked)
    const [localFilters, setLocalFilters] = useState(currentFilters);

    // Sync local filters when URL params change
    useEffect(() => {
        setLocalFilters(currentFilters);
        setHasUnappliedChanges(false);
    }, [currentFilters]);

    // Check if local filters differ from applied filters
    useEffect(() => {
        const hasChanges =
            JSON.stringify(localFilters.genres.sort()) !== JSON.stringify(currentFilters.genres.sort()) ||
            localFilters.type !== currentFilters.type ||
            localFilters.status !== currentFilters.status ||
            localFilters.season !== currentFilters.season ||
            localFilters.year !== currentFilters.year ||
            localFilters.minRating !== currentFilters.minRating ||
            localFilters.maxRating !== currentFilters.maxRating ||
            localFilters.studio !== currentFilters.studio;
        
        setHasUnappliedChanges(hasChanges);
    }, [localFilters, currentFilters]);

    // Update a single local filter
    const updateLocalFilter = useCallback((key, value) => {
        setLocalFilters(prev => ({ ...prev, [key]: value }));
    }, []);

    // Toggle a genre in the local filter
    const toggleLocalGenre = useCallback((genreSlug) => {
        setLocalFilters(prev => {
            const current = prev.genres;
            const updated = current.includes(genreSlug)
                ? current.filter(g => g !== genreSlug)
                : [...current, genreSlug];
            return { ...prev, genres: updated };
        });
    }, []);

    // Apply local filters to URL
    const applyFilters = useCallback(() => {
        const newParams = new URLSearchParams(searchParams);

        if (localFilters.genres.length > 0) {
            newParams.set('genre', localFilters.genres.join(','));
        } else {
            newParams.delete('genre');
        }

        if (localFilters.type) {
            newParams.set('type', localFilters.type);
        } else {
            newParams.delete('type');
        }

        if (localFilters.status) {
            newParams.set('status', localFilters.status);
        } else {
            newParams.delete('status');
        }

        if (localFilters.season) {
            newParams.set('season', localFilters.season);
        } else {
            newParams.delete('season');
        }

        if (localFilters.year) {
            newParams.set('year', localFilters.year);
        } else {
            newParams.delete('year');
        }

        if (localFilters.minRating) {
            newParams.set('min_rating', localFilters.minRating);
        } else {
            newParams.delete('min_rating');
        }

        if (localFilters.maxRating) {
            newParams.set('max_rating', localFilters.maxRating);
        } else {
            newParams.delete('max_rating');
        }

        if (localFilters.studio) {
            newParams.set('studio', localFilters.studio);
        } else {
            newParams.delete('studio');
        }

        setSearchParams(newParams);
    }, [localFilters, searchParams, setSearchParams]);

    // Reset local filters to match current URL filters
    const resetFilters = useCallback(() => {
        setLocalFilters(currentFilters);
    }, [currentFilters]);

    // Check if any filters are active
    const hasActiveFilters = useMemo(() =>
        currentFilters.genres.length > 0 ||
        currentFilters.type ||
        currentFilters.status ||
        currentFilters.studio ||
        currentFilters.season ||
        currentFilters.year ||
        currentFilters.minRating ||
        currentFilters.maxRating,
        [currentFilters]
    );

    // Clear all filters
    const clearAllFilters = useCallback(() => {
        setSearchParams({});
    }, [setSearchParams]);

    // Update a single URL param directly
    const updateParam = useCallback((key, value) => {
        const newParams = new URLSearchParams(searchParams);
        if (value) {
            newParams.set(key, value);
        } else {
            newParams.delete(key);
        }
        setSearchParams(newParams);
    }, [searchParams, setSearchParams]);

    // Toggle an array param in URL
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

    return {
        // Current (applied) filters from URL
        currentFilters,
        // Local (unapplied) filters
        localFilters,
        // Actions
        updateLocalFilter,
        toggleLocalGenre,
        applyFilters,
        resetFilters,
        clearAllFilters,
        updateParam,
        toggleArrayParam,
        // State
        hasUnappliedChanges,
        hasActiveFilters,
    };
}

export default useBrowseFilters;
