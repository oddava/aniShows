import { useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminQueries } from '../../../api/queries/admin';
import { useFreshError, useReportError } from '../../../hooks/useQueryErrorReport';

export const ADMIN_PAGE_SIZE = 20;

/**
 * Defaults for every admin read, chosen to match what the pages did when they
 * fetched in useEffect:
 * - staleTime 0: a page refetches each time it mounts (cached rows show meanwhile);
 * - retry false: one request per fetch, so a failure is reported at once.
 */
export const ADMIN_QUERY_DEFAULTS = { staleTime: 0, retry: false };

/** The message the pages show for a failed request: the API's `detail`, else a fallback. */
export const getAdminErrorMessage = (error, fallback) => error?.response?.data?.detail || fallback;

/** A 404 on page > 1 means the page no longer exists (e.g. its last row was deleted). */
export const isVanishedPage = (error, page) => error?.response?.status === 404 && page > 1;

/**
 * useQuery with the admin defaults plus the old error reporting. `error` is
 * only set for a failure of this visit (see useFreshError).
 *
 *   const dashboard = useAdminQuery({ ...adminQueries.dashboard(), errorLog: 'Failed to fetch dashboard stats:' });
 */
export function useAdminQuery({ errorLog, errorToast, ...options }) {
    const query = useQuery({ ...ADMIN_QUERY_DEFAULTS, ...options });
    const error = useFreshError(query, options.queryKey);
    useReportError(error, query.errorUpdatedAt, { log: errorLog, toastMessage: errorToast });
    return { ...query, error };
}

/**
 * One page of a DRF-paginated admin list (`/admin/<resource>/?<params>`).
 *
 * - The previous page's rows stay on screen while the next page loads, and
 *   after a failed fetch, as they did when rows lived in useState.
 * - A 404 for page > 1 steps back one page instead of erroring, so deleting the
 *   last row of the last page (or narrowing a filter) cannot strand the admin.
 * - `isFetching` is true for every request, including refetches after a
 *   mutation, which is when the pages used to show their loading state.
 */
export function useAdminList({
    resource,
    params,
    page,
    setPage,
    pageSize = ADMIN_PAGE_SIZE,
    errorLog,
    errorToast,
    ...options
}) {
    const listOptions = adminQueries.list(resource, params);
    const query = useQuery({
        ...ADMIN_QUERY_DEFAULTS,
        ...listOptions,
        placeholderData: keepPreviousData,
        ...options,
    });
    const freshError = useFreshError(query, listOptions.queryKey);

    const vanished = isVanishedPage(freshError, page);
    useEffect(() => {
        if (vanished) {
            setPage((current) => Math.max(1, current - 1));
        }
    }, [vanished, setPage]);

    // Log every failure; only toast when the page did not simply vanish.
    useReportError(freshError, query.errorUpdatedAt, { log: errorLog });
    useReportError(freshError, query.errorUpdatedAt, { toastMessage: errorToast, skip: vanished });

    const lastData = useRef(undefined);
    if (query.data !== undefined) {
        lastData.current = query.data;
    }
    const current = query.data ?? lastData.current;
    const count = current?.count || 0;

    return {
        ...query,
        data: current,
        items: current?.results || [],
        count,
        totalPages: Math.ceil(count / pageSize) || 1,
        error: vanished ? null : freshError,
    };
}

/**
 * useMutation that refetches the given admin keys after a success (what the
 * pages did by calling their fetchX() again). Errors are left to the caller,
 * which keeps its own alert/toast.
 */
export function useAdminMutation(mutationFn, { invalidate = [] } = {}) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: () => {
            invalidate.forEach((queryKey) => {
                queryClient.invalidateQueries({ queryKey });
            });
        },
    });
}
