import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { notificationKeys } from '../../api/queries/notifications';
import {
    flattenFeed,
    setUnreadNotificationCount,
    updateFeedItems,
    updateNotificationFeeds,
    useMarkAllNotificationsRead,
    useMarkNotificationRead,
    useUnreadNotificationCount,
    useUnreadNotifications,
} from '../useNotifications';

const api = vi.hoisted(() => ({
    getUnreadCount: vi.fn(),
    getAll: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());

vi.mock('../../api/client', () => ({ notificationApi: api, animeApi: {}, authApi: {} }));
vi.mock('../../utils/logger', () => ({ default: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const USER = 5;
const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperFor = (client) => function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
const item = (id, extra = {}) => ({ id, is_read: false, ...extra });
const feedOf = (...pages) => ({
    pages: pages.map((results, index) => ({ results, next: index < pages.length - 1 ? `/n/?page=${index + 2}` : null })),
    pageParams: pages.map((_, index) => index + 1),
});

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    logError.mockReset();
});

describe('feed helpers', () => {
    it('flattens pages and drops duplicates', () => {
        expect(flattenFeed(feedOf([item(1), item(2)], [item(2), item(3)])).map((n) => n.id)).toEqual([1, 2, 3]);
        expect(flattenFeed(undefined)).toEqual([]);
    });

    it('puts additions on the first page and keeps later pages and next links', () => {
        const data = feedOf([item(1), item(2)], [item(3)]);
        const next = updateFeedItems(data, (items) => [item(0), ...items]);
        expect(next.pages[0].results.map((n) => n.id)).toEqual([0, 1, 2]);
        expect(next.pages[1].results.map((n) => n.id)).toEqual([3]);
        expect(next.pages[0].next).toBe('/n/?page=2');
        expect(next.pageParams).toEqual([1, 2]);
    });

    it('removes items wherever they are', () => {
        const data = feedOf([item(1), item(2)], [item(3), item(4)]);
        const next = updateFeedItems(data, (items) => items.filter((n) => n.id !== 3));
        expect(flattenFeed(next).map((n) => n.id)).toEqual([1, 2, 4]);
    });

    it('leaves missing data alone', () => {
        expect(updateFeedItems(undefined, (items) => [item(9), ...items])).toBeUndefined();
    });

    it('updates every feed of the user only', () => {
        const client = makeClient();
        client.setQueryData(notificationKeys.feed(USER, 30), feedOf([item(1)]));
        client.setQueryData(notificationKeys.feed(99, 30), feedOf([item(1)]));
        updateNotificationFeeds(client, USER, (items) => items.map((n) => ({ ...n, is_read: true })));
        expect(flattenFeed(client.getQueryData(notificationKeys.feed(USER, 30)))[0].is_read).toBe(true);
        expect(flattenFeed(client.getQueryData(notificationKeys.feed(99, 30)))[0].is_read).toBe(false);
    });

    it('writes the badge count from a number or an updater', () => {
        const client = makeClient();
        setUnreadNotificationCount(client, USER, (count) => count + 2);
        expect(client.getQueryData(notificationKeys.unreadCount(USER))).toBe(2);
        setUnreadNotificationCount(client, USER, 7);
        expect(client.getQueryData(notificationKeys.unreadCount(USER))).toBe(7);
    });
});

describe('useUnreadNotificationCount', () => {
    it('loads the count', async () => {
        api.getUnreadCount.mockResolvedValue({ data: { count: 3 } });
        const { result } = renderHook(() => useUnreadNotificationCount(USER), { wrapper: wrapperFor(makeClient()) });
        await waitFor(() => expect(result.current.data).toBe(3));
    });

    it('logs a failure once and does not retry', async () => {
        api.getUnreadCount.mockRejectedValue(new Error('down'));
        const { result } = renderHook(
            () => useUnreadNotificationCount(USER, { errorLog: 'Failed to fetch notification count:' }),
            { wrapper: wrapperFor(makeClient()) },
        );
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledWith('Failed to fetch notification count:', expect.any(Error));
    });

    it('with enabled: false only reads what was written', async () => {
        const client = makeClient();
        const { result } = renderHook(() => useUnreadNotificationCount(USER, { enabled: false }), {
            wrapper: wrapperFor(client),
        });
        expect(result.current.data).toBeUndefined();
        act(() => setUnreadNotificationCount(client, USER, 4));
        await waitFor(() => expect(result.current.data).toBe(4));
        expect(api.getUnreadCount).not.toHaveBeenCalled();
    });
});

describe('useUnreadNotifications', () => {
    it('fetches only while enabled, and again on each enable', async () => {
        api.getAll.mockResolvedValue({ data: { results: [item(1)] } });
        const client = makeClient();
        const { result, rerender } = renderHook(({ open }) => useUnreadNotifications(USER, { enabled: open }), {
            wrapper: wrapperFor(client),
            initialProps: { open: false },
        });
        expect(api.getAll).not.toHaveBeenCalled();

        rerender({ open: true });
        await waitFor(() => expect(result.current.data).toEqual([item(1)]));
        expect(api.getAll).toHaveBeenCalledWith({ is_read: false });

        rerender({ open: false });
        rerender({ open: true });
        await waitFor(() => expect(api.getAll).toHaveBeenCalledTimes(2));
    });
});

describe('mark read mutations', () => {
    const seed = (client) => {
        client.setQueryData(notificationKeys.unread(USER), [item(1), item(2)]);
        client.setQueryData(notificationKeys.feed(USER, 30), feedOf([item(1), item(2), item(3, { is_read: true })]));
        client.setQueryData(notificationKeys.unreadCount(USER), 2);
    };

    it('marking one read updates the list, the feed and the badge', async () => {
        api.markAsRead.mockResolvedValue({});
        const client = makeClient();
        seed(client);
        const { result } = renderHook(() => useMarkNotificationRead(USER), { wrapper: wrapperFor(client) });

        await act(() => result.current.mutateAsync(1));

        expect(api.markAsRead).toHaveBeenCalledWith(1);
        expect(client.getQueryData(notificationKeys.unread(USER))).toEqual([item(2)]);
        expect(flattenFeed(client.getQueryData(notificationKeys.feed(USER, 30))).map((n) => n.is_read))
            .toEqual([true, false, true]);
        expect(client.getQueryData(notificationKeys.unreadCount(USER))).toBe(1);
    });

    it('a failed mark-read changes nothing', async () => {
        api.markAsRead.mockRejectedValue(new Error('no'));
        const client = makeClient();
        seed(client);
        const { result } = renderHook(() => useMarkNotificationRead(USER), { wrapper: wrapperFor(client) });

        await expect(act(() => result.current.mutateAsync(1))).rejects.toThrow('no');
        expect(client.getQueryData(notificationKeys.unread(USER))).toHaveLength(2);
        expect(client.getQueryData(notificationKeys.unreadCount(USER))).toBe(2);
    });

    it('never takes the badge below zero', async () => {
        api.markAsRead.mockResolvedValue({});
        const client = makeClient();
        client.setQueryData(notificationKeys.unreadCount(USER), 0);
        const { result } = renderHook(() => useMarkNotificationRead(USER), { wrapper: wrapperFor(client) });
        await act(() => result.current.mutateAsync(1));
        expect(client.getQueryData(notificationKeys.unreadCount(USER))).toBe(0);
    });

    it('marking all read empties the list, reads the feed and zeroes the badge', async () => {
        api.markAllAsRead.mockResolvedValue({});
        const client = makeClient();
        seed(client);
        const { result } = renderHook(() => useMarkAllNotificationsRead(USER), { wrapper: wrapperFor(client) });

        await act(() => result.current.mutateAsync());

        expect(client.getQueryData(notificationKeys.unread(USER))).toEqual([]);
        expect(flattenFeed(client.getQueryData(notificationKeys.feed(USER, 30))).every((n) => n.is_read)).toBe(true);
        expect(client.getQueryData(notificationKeys.unreadCount(USER))).toBe(0);
    });
});
