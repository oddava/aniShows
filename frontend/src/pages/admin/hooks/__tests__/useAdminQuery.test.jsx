import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { adminKeys } from '../../../../api/queries/admin';
import {
    getAdminErrorMessage,
    isVanishedPage,
    useAdminList,
    useAdminMutation,
    useAdminQuery,
} from '../useAdminQuery';

const { getMock, toastError, logError } = vi.hoisted(() => ({
    getMock: vi.fn(),
    toastError: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('../../../../api/client', () => ({ default: { get: (...args) => getMock(...args) } }));
vi.mock('react-hot-toast', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('../../../../utils/logger', () => ({ default: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperFor = (client) => function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const pageOf = (url) => new URL(url, 'http://x').searchParams.get('page');
const notFound = { response: { status: 404, data: { detail: 'Invalid page.' } } };

beforeEach(() => {
    getMock.mockReset();
    toastError.mockReset();
    logError.mockReset();
});

describe('helpers', () => {
    it('prefers the API detail for error messages', () => {
        expect(getAdminErrorMessage({ response: { data: { detail: 'Nope' } } }, 'Fallback')).toBe('Nope');
        expect(getAdminErrorMessage(new Error('x'), 'Fallback')).toBe('Fallback');
        expect(getAdminErrorMessage(null, 'Fallback')).toBe('Fallback');
    });

    it('treats only a 404 past page 1 as a vanished page', () => {
        expect(isVanishedPage(notFound, 2)).toBe(true);
        expect(isVanishedPage(notFound, 1)).toBe(false);
        expect(isVanishedPage({ response: { status: 500 } }, 3)).toBe(false);
    });
});

describe('useAdminQuery', () => {
    const options = (queryFn) => ({ queryKey: adminKeys.dashboard(), queryFn });

    it('is pending, then returns data', async () => {
        const client = makeClient();
        const { result } = renderHook(() => useAdminQuery(options(() => Promise.resolve({ ok: 1 }))), {
            wrapper: wrapperFor(client),
        });
        expect(result.current.isPending).toBe(true);
        await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
        expect(result.current.error).toBeNull();
    });

    it('logs and toasts a failure once, and does not retry', async () => {
        const client = makeClient();
        const queryFn = vi.fn(() => Promise.reject(new Error('boom')));
        const { result, rerender } = renderHook(
            () => useAdminQuery({ ...options(queryFn), errorLog: 'Failed:', errorToast: (e) => `Toast ${e.message}` }),
            { wrapper: wrapperFor(client) },
        );
        await waitFor(() => expect(result.current.error).toBeTruthy());
        rerender();
        rerender();

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledWith('Failed:', expect.any(Error));
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(toastError).toHaveBeenCalledWith('Toast boom');
    });

    it('reports each failed refetch again', async () => {
        const client = makeClient();
        const { result } = renderHook(
            () => useAdminQuery({ ...options(() => Promise.reject(new Error('boom'))), errorToast: 'Failed' }),
            { wrapper: wrapperFor(client) },
        );
        await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
        await act(() => result.current.refetch());
        await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    });

    it('ignores an error cached by an earlier visit, then refetches on mount', async () => {
        const client = makeClient();
        const first = renderHook(
            () => useAdminQuery({ ...options(() => Promise.reject(new Error('old'))), errorToast: 'Failed' }),
            { wrapper: wrapperFor(client) },
        );
        await waitFor(() => expect(first.result.current.error).toBeTruthy());
        first.unmount();
        expect(toastError).toHaveBeenCalledTimes(1);

        const queryFn = vi.fn(() => Promise.resolve({ ok: 2 }));
        const second = renderHook(() => useAdminQuery({ ...options(queryFn), errorToast: 'Failed' }), {
            wrapper: wrapperFor(client),
        });
        // The old failure is neither shown nor toasted again.
        expect(second.result.current.error).toBeNull();
        await waitFor(() => expect(second.result.current.data).toEqual({ ok: 2 }));
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(toastError).toHaveBeenCalledTimes(1);
    });
});

describe('useAdminList', () => {
    const useList = (extra = {}) => {
        const [page, setPage] = useState(1);
        const list = useAdminList({
            resource: 'genres',
            params: { page },
            page,
            setPage,
            errorLog: 'Failed to fetch genres:',
            errorToast: 'Failed to load genres',
            ...extra,
        });
        return { ...list, page, setPage };
    };

    it('requests /admin/<resource>/?<params> and pages with ADMIN_PAGE_SIZE', async () => {
        getMock.mockResolvedValue({ data: { results: [{ id: 1 }], count: 41 } });
        const { result } = renderHook(() => useList(), { wrapper: wrapperFor(makeClient()) });

        await waitFor(() => expect(result.current.items).toEqual([{ id: 1 }]));
        expect(getMock.mock.calls[0][0]).toBe('/admin/genres/?page=1');
        expect(result.current.count).toBe(41);
        expect(result.current.totalPages).toBe(3);
    });

    it('has one page (not zero) when the list is empty', async () => {
        getMock.mockResolvedValue({ data: { results: [], count: 0 } });
        const { result } = renderHook(() => useList(), { wrapper: wrapperFor(makeClient()) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.items).toEqual([]);
        expect(result.current.totalPages).toBe(1);
    });

    it('keeps the current rows while the next page loads', async () => {
        let resolvePage2;
        getMock.mockImplementation((url) => (pageOf(url) === '1'
            ? Promise.resolve({ data: { results: [{ id: 1 }], count: 40 } })
            : new Promise((resolve) => { resolvePage2 = resolve; })));
        const { result } = renderHook(() => useList(), { wrapper: wrapperFor(makeClient()) });
        await waitFor(() => expect(result.current.items).toEqual([{ id: 1 }]));

        act(() => result.current.setPage(2));
        await waitFor(() => expect(result.current.isFetching).toBe(true));
        expect(result.current.items).toEqual([{ id: 1 }]);

        await act(async () => resolvePage2({ data: { results: [{ id: 21 }], count: 40 } }));
        await waitFor(() => expect(result.current.items).toEqual([{ id: 21 }]));
    });

    it('keeps the last rows and toasts once when a fetch fails', async () => {
        getMock.mockImplementation((url) => (pageOf(url) === '1'
            ? Promise.resolve({ data: { results: [{ id: 1 }], count: 40 } })
            : Promise.reject({ response: { status: 500 } })));
        const { result } = renderHook(() => useList(), { wrapper: wrapperFor(makeClient()) });
        await waitFor(() => expect(result.current.items).toEqual([{ id: 1 }]));

        act(() => result.current.setPage(2));
        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.isFetching).toBe(false);
        expect(result.current.items).toEqual([{ id: 1 }]);
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(toastError).toHaveBeenCalledWith('Failed to load genres');
        expect(logError).toHaveBeenCalledTimes(1);
    });

    it('steps back a page, without a toast or error, when the page no longer exists', async () => {
        getMock.mockImplementation((url) => (pageOf(url) === '2'
            ? Promise.reject(notFound)
            : Promise.resolve({ data: { results: [{ id: 1 }], count: 40 } })));
        const { result } = renderHook(() => useList(), { wrapper: wrapperFor(makeClient()) });
        await waitFor(() => expect(result.current.items).toEqual([{ id: 1 }]));

        act(() => result.current.setPage(2));
        await waitFor(() => expect(result.current.page).toBe(1));
        expect(result.current.error).toBeNull();
        expect(toastError).not.toHaveBeenCalled();
        // Still logged, like every failure.
        expect(logError).toHaveBeenCalledWith('Failed to fetch genres:', notFound);
    });
});

describe('useAdminMutation', () => {
    it('invalidates every page and filter of the given resources after success', async () => {
        const client = makeClient();
        const usersPage1 = adminKeys.list('users', { page: 1 });
        const usersPage2 = adminKeys.list('users', { page: 2, search: 'a' });
        const anime = adminKeys.list('anime', { page: 1 });
        [usersPage1, usersPage2, anime].forEach((key) => client.setQueryData(key, { results: [] }));

        const mutationFn = vi.fn(() => Promise.resolve('done'));
        const { result } = renderHook(
            () => useAdminMutation(mutationFn, { invalidate: [adminKeys.resource('users')] }),
            { wrapper: wrapperFor(client) },
        );
        await act(() => result.current.mutateAsync(7));

        expect(mutationFn).toHaveBeenCalledWith(7, expect.anything());
        expect(client.getQueryState(usersPage1).isInvalidated).toBe(true);
        expect(client.getQueryState(usersPage2).isInvalidated).toBe(true);
        expect(client.getQueryState(anime).isInvalidated).toBe(false);
    });

    it('invalidates nothing when the request fails', async () => {
        const client = makeClient();
        const key = adminKeys.list('users', { page: 1 });
        client.setQueryData(key, { results: [] });
        const { result } = renderHook(
            () => useAdminMutation(() => Promise.reject(new Error('no')), { invalidate: [adminKeys.resource('users')] }),
            { wrapper: wrapperFor(client) },
        );
        await expect(act(() => result.current.mutateAsync(1))).rejects.toThrow('no');
        expect(client.getQueryState(key).isInvalidated).toBe(false);
    });
});
