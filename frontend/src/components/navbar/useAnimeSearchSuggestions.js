import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { navbarSearchQueries } from '../../api/queries/anime';
import { useAuth } from '../../context/AuthContext';
import { useFreshError, useReportError } from '../../hooks/useQueryErrorReport';

/** Same as the backend's MIN_SEARCH_LENGTH: shorter queries are ignored there. */
export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 200;
const SUGGESTIONS_STALE_TIME_MS = 60_000;
const NO_RESULTS = [];

/**
 * Search suggestions for a search box (navbar and hero; B8, B9, P1-1): one
 * server-side, relevance-ranked query per trimmed input of at least
 * MIN_SEARCH_LENGTH characters, debounced. A request the user has typed past
 * is aborted; the previous results stay up while the next ones load.
 *
 * Returns `{ results, term, isActive, isSearching, noMatches }`:
 * - `results`: suggestions for `term` ([] while the input is too short);
 * - `isActive`: the input is long enough to search;
 * - `isSearching`: a debounce or request is pending;
 * - `noMatches`: the search for exactly what is typed finished with nothing.
 */
export default function useAnimeSearchSuggestions(query) {
    const { user } = useAuth();
    const adultContentEnabled = Boolean(user?.show_adult_content);
    const trimmed = (query || '').trim();
    const [debounced, setDebounced] = useState(trimmed);

    useEffect(() => {
        const id = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(id);
    }, [trimmed]);

    const isActive = trimmed.length >= MIN_SEARCH_LENGTH;
    const term = debounced.length >= MIN_SEARCH_LENGTH ? debounced : '';
    const options = navbarSearchQueries.results(term, adultContentEnabled);
    const search = useQuery({
        ...options,
        enabled: isActive && term !== '',
        placeholderData: keepPreviousData,
        staleTime: SUGGESTIONS_STALE_TIME_MS,
        retry: false,
    });
    useReportError(useFreshError(search, options.queryKey), search.errorUpdatedAt, { log: 'Search failed:' });

    const isDebouncing = trimmed !== debounced;
    const results = isActive && search.data ? search.data : NO_RESULTS;
    const isSearching = isActive && (isDebouncing || search.isFetching);

    return {
        results,
        term,
        isActive,
        isSearching,
        noMatches: isActive && !isSearching && search.isSuccess && !search.isPlaceholderData && results.length === 0,
    };
}
