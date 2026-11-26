import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../context/AuthContext';
import { notify, notifyError } from '../components/ui/toast';
import { adminApi, adminKeys, cleanParams, errorMessage } from './api';

export const PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;

/** Admin reads: refetch on mount, no silent retries (a failure shows at once). */
const QUERY_DEFAULTS = { staleTime: 15_000, retry: false, refetchOnWindowFocus: false };

/** The signed-in admin's tier. Staff moderate; superusers also run the site. */
export function useRole() {
    const { user } = useAuth();
    const isSuperuser = Boolean(user?.is_superuser);
    return {
        user,
        userId: user?.id ?? null,
        isSuperuser,
        isStaff: isSuperuser || Boolean(user?.is_staff),
    };
}

/** `value`, once it has stopped changing for `delay` ms. */
export function useDebouncedValue(value, delay = SEARCH_DEBOUNCE_MS) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

/**
 * List state (page, search, sort, filters) kept in the URL, so a filtered view
 * survives a reload, the back button works and a link can be shared.
 *
 *   const list = useListParams({ ordering: '-date_joined', is_active: '' });
 *   list.values.is_active; list.set({ is_active: 'true' }); list.setPage(2);
 *   useAdminList('users', list.apiParams)
 *
 * Any change other than the page goes back to page 1. Defaults are left out
 * of the URL. `search` is typed into `searchInput` and reaches `apiParams`
 * debounced.
 */
export function useListParams(defaults = {}, { pageSize = PAGE_SIZE } = {}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const defaultsRef = useRef(defaults);

    const values = useMemo(() => {
        const result = { ...defaultsRef.current };
        Object.keys(defaultsRef.current).forEach((key) => {
            if (searchParams.has(key)) result[key] = searchParams.get(key);
        });
        return result;
    }, [searchParams]);

    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const urlSearch = searchParams.get('q') || '';
    const [searchInput, setSearchInput] = useState(urlSearch);
    const debouncedSearch = useDebouncedValue(searchInput);

    const update = useCallback((patch, { keepPage = false } = {}) => {
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            Object.entries(patch).forEach(([key, value]) => {
                const isDefault = key in defaultsRef.current && String(defaultsRef.current[key] ?? '') === String(value ?? '');
                if (value === undefined || value === null || value === '' || isDefault) next.delete(key);
                else next.set(key, String(value));
            });
            if (!keepPage && !('page' in patch)) next.delete('page');
            if (next.get('page') === '1') next.delete('page');
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    // Typing settles into the URL (and the request) after the debounce.
    useEffect(() => {
        if (debouncedSearch.trim() !== urlSearch) update({ q: debouncedSearch.trim() });
    }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Back/forward or a link changed q: show it in the box.
    useEffect(() => {
        setSearchInput((current) => (current.trim() === urlSearch ? current : urlSearch));
    }, [urlSearch]);

    const setPage = useCallback((next) => {
        const value = typeof next === 'function' ? next(page) : next;
        update({ page: Math.max(1, value) }, { keepPage: true });
    }, [page, update]);

    // Clears this list's search, filters and page; keeps params it does not
    // manage (a page's ?tab=, an ?open= drawer).
    const reset = useCallback(() => {
        setSearchInput('');
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            ['q', 'page', ...Object.keys(defaultsRef.current)].forEach((key) => next.delete(key));
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    const isFiltered = Boolean(urlSearch) || Object.keys(defaultsRef.current).some(
        (key) => key !== 'ordering' && String(values[key] ?? '') !== String(defaultsRef.current[key] ?? ''),
    );

    const apiParams = useMemo(
        () => cleanParams({ ...values, search: urlSearch, page, page_size: pageSize }),
        [values, urlSearch, page, pageSize],
    );

    return {
        values,
        set: update,
        page,
        setPage,
        search: urlSearch,
        searchInput,
        setSearchInput,
        apiParams,
        pageSize,
        isFiltered,
        reset,
    };
}

/**
 * The record open in a drawer, kept in `?open=<id>` so it can be linked to.
 * Opening adds a history entry (Back closes the drawer); closing replaces it.
 *
 *   const [openId, setOpenId] = useOpenParam();
 */
export function useOpenParam(name = 'open') {
    const [searchParams, setSearchParams] = useSearchParams();
    const value = searchParams.get(name);
    const set = useCallback((id) => {
        const closing = id === null || id === undefined || id === '';
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            if (closing) next.delete(name);
            else next.set(name, String(id));
            return next;
        }, { replace: closing });
    }, [name, setSearchParams]);
    return [value, set];
}

/**
 * One page of a DRF-paginated admin list. Rows of the previous page stay on
 * screen while the next loads; a 404 past page 1 (the last row was deleted,
 * a filter narrowed) steps back a page instead of showing an error.
 */
export function useAdminList(resource, params, { pageSize = PAGE_SIZE, onVanishedPage, ...options } = {}) {
    const query = useQuery({
        ...QUERY_DEFAULTS,
        queryKey: adminKeys.list(resource, params),
        queryFn: ({ signal }) => adminApi.get(resource, params, { signal }),
        placeholderData: keepPreviousData,
        ...options,
    });

    const page = Number(params?.page || 1);
    const vanished = query.error?.response?.status === 404 && page > 1;
    useEffect(() => {
        if (vanished) onVanishedPage?.(page - 1);
    }, [vanished]); // eslint-disable-line react-hooks/exhaustive-deps

    const data = query.data;
    const rows = Array.isArray(data) ? data : data?.results || [];
    const count = Array.isArray(data) ? data.length : data?.count ?? rows.length;

    return {
        ...query,
        rows,
        count,
        totalPages: Math.max(1, Math.ceil(count / pageSize)),
        error: vanished ? null : query.error,
        isInitialLoading: query.isLoading && !data,
    };
}

/** A single admin read: `useAdminQuery(['admin','dashboard'], () => adminApi.get('dashboard'))`. */
export function useAdminQuery(queryKey, queryFn, options = {}) {
    return useQuery({ ...QUERY_DEFAULTS, queryKey, queryFn, ...options });
}

/**
 * A write: toasts the outcome and refetches what it changed.
 *
 *   const suspend = useAdminAction(
 *       ({ id, reason }) => adminApi.post(`users/${id}/suspend`, { reason }),
 *       { invalidate: [adminKeys.resource('users')], success: (data) => data.message },
 *   );
 *   suspend.mutate({ id, reason });
 *
 * `success` is a string, a function of the response, or false for no toast.
 * `error` is the fallback message when the API gives none.
 */
export function useAdminAction(mutationFn, {
    invalidate = [],
    success = 'Saved.',
    error: errorFallback = 'That did not work. Try again.',
    onSuccess,
    onError,
} = {}) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: async (data, variables, context) => {
            await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
            const message = typeof success === 'function' ? success(data, variables) : success;
            if (message) notify(message);
            onSuccess?.(data, variables, context);
        },
        onError: (err, variables, context) => {
            notifyError(errorMessage(err, errorFallback));
            onError?.(err, variables, context);
        },
    });
}

/**
 * Row selection for bulk actions. Selection is by id and survives paging; it
 * clears when `resetKey` changes (filters or search).
 */
export function useSelection(resetKey) {
    const [selected, setSelected] = useState(() => new Set());
    const key = JSON.stringify(resetKey ?? null);
    const [lastKey, setLastKey] = useState(key);
    // React's "adjust state when a prop changes" pattern: state, not a ref,
    // so a discarded concurrent render leaves nothing behind.
    if (lastKey !== key) {
        setLastKey(key);
        setSelected(new Set());
    }

    const toggle = useCallback((id) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const setMany = useCallback((ids, on) => {
        setSelected((current) => {
            const next = new Set(current);
            ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
            return next;
        });
    }, []);

    const clear = useCallback(() => setSelected(new Set()), []);

    return { selected, ids: [...selected], count: selected.size, toggle, setMany, clear, has: (id) => selected.has(id) };
}

/** Moderation counts for the nav badge: every 60 s, only while the tab is visible. */
export function useModerationSummary() {
    return useQuery({
        queryKey: adminKeys.view('moderation/summary'),
        queryFn: ({ signal }) => adminApi.get('moderation/summary', undefined, { signal }),
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
        retry: false,
        staleTime: 30_000,
    });
}
