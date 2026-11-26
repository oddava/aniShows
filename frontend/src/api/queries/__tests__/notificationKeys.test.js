import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
    notificationKeys,
    notificationQueries,
    parseNextPageNumber,
} from '../notifications';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    getUnreadCount: vi.fn(),
    getAll: vi.fn(),
    getPreferences: vi.fn(),
    getSubscriptions: vi.fn(),
    getPushConfig: vi.fn(),
}));

vi.mock('../../client', () => ({
    default: { get: mocks.get },
    notificationApi: {
        getUnreadCount: mocks.getUnreadCount,
        getAll: mocks.getAll,
        getPreferences: mocks.getPreferences,
        getSubscriptions: mocks.getSubscriptions,
        getPushConfig: mocks.getPushConfig,
    },
}));

beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

describe('notificationKeys', () => {
    it('scopes everything by user', () => {
        expect(notificationKeys.forUser(7)).toEqual(['notifications', 7]);
        expect(notificationKeys.forUser(undefined)).toEqual(['notifications', 'anonymous']);
        expect(notificationKeys.unreadCount(7)).toEqual(['notifications', 7, 'unread-count']);
        expect(notificationKeys.unread(7)).toEqual(['notifications', 7, 'unread']);
        expect(notificationKeys.feed(7, 30)).toEqual(['notifications', 7, 'feed', 30]);
        expect(notificationKeys.preferences(7)).toEqual(['notifications', 7, 'preferences']);
    });

    it('does not let one user\'s invalidation touch another\'s', async () => {
        const client = new QueryClient();
        client.setQueryData(notificationKeys.unreadCount(1), 3);
        client.setQueryData(notificationKeys.unreadCount(2), 5);
        await client.invalidateQueries({ queryKey: notificationKeys.forUser(1) });
        expect(client.getQueryState(notificationKeys.unreadCount(1)).isInvalidated).toBe(true);
        expect(client.getQueryState(notificationKeys.unreadCount(2)).isInvalidated).toBe(false);
    });

    it('parses the DRF next link', () => {
        expect(parseNextPageNumber(null)).toBeNull();
        expect(parseNextPageNumber('http://api.test/notifications/?page=3&page_size=30')).toBe(3);
        expect(parseNextPageNumber('/notifications/?page=2')).toBe(2);
        expect(parseNextPageNumber('/notifications/?page_size=30')).toBeNull();
    });

    it('fetches the count, the unread list, the feed pages and preferences', async () => {
        mocks.getUnreadCount.mockResolvedValue({ data: { count: 4 } });
        await expect(notificationQueries.unreadCount(1).queryFn()).resolves.toBe(4);
        mocks.getUnreadCount.mockResolvedValue({ data: {} });
        await expect(notificationQueries.unreadCount(1).queryFn()).resolves.toBe(0);

        mocks.getAll.mockResolvedValue({ data: { results: [{ id: 1 }] } });
        await expect(notificationQueries.unread(1).queryFn()).resolves.toEqual([{ id: 1 }]);
        expect(mocks.getAll).toHaveBeenLastCalledWith({ is_read: false });

        const feed = notificationQueries.feed(1, 30);
        expect(feed.initialPageParam).toBe(1);
        mocks.getAll.mockResolvedValue({ data: { results: [], next: '/notifications/?page=3' } });
        const page = await feed.queryFn({ pageParam: 2 });
        expect(mocks.getAll).toHaveBeenLastCalledWith({ page_size: 30, page: 2 });
        expect(feed.getNextPageParam(page)).toBe(3);
        expect(feed.getNextPageParam({ next: null })).toBeNull();

        mocks.getPreferences.mockResolvedValue({ data: { email_enabled: true } });
        await expect(notificationQueries.preferences(1).queryFn()).resolves.toEqual({ email_enabled: true });
    });

    it('adds the category to the feed key and request only when there is one', async () => {
        expect(notificationKeys.feed(1, 30)).toEqual(['notifications', 1, 'feed', 30]);
        expect(notificationKeys.feed(1, 30, 'replies')).toEqual(['notifications', 1, 'feed', 30, 'replies']);
        expect(notificationQueries.feed(1, 30, 'replies').queryKey).toEqual(['notifications', 1, 'feed', 30, 'replies']);

        mocks.getAll.mockResolvedValue({ data: { results: [], next: null } });
        await notificationQueries.feed(1, 30, 'replies').queryFn({ pageParam: 1 });
        expect(mocks.getAll).toHaveBeenLastCalledWith({ page_size: 30, page: 1, category: 'replies' });
    });

    it('fetches devices and the push config', async () => {
        expect(notificationKeys.devices(3)).toEqual(['notifications', 3, 'devices']);
        expect(notificationKeys.pushConfig()).toEqual(['notifications', 'push-config']);

        mocks.getSubscriptions.mockResolvedValue({ data: [{ id: 1 }] });
        await expect(notificationQueries.devices(3).queryFn()).resolves.toEqual([{ id: 1 }]);
        mocks.getSubscriptions.mockResolvedValue({ data: { results: [{ id: 2 }] } });
        await expect(notificationQueries.devices(3).queryFn()).resolves.toEqual([{ id: 2 }]);

        mocks.getPushConfig.mockResolvedValue({ data: { enabled: true, public_key: 'BKey' } });
        await expect(notificationQueries.pushConfig().queryFn()).resolves.toEqual({ enabled: true, publicKey: 'BKey' });
        mocks.getPushConfig.mockResolvedValue({ data: { enabled: true, public_key: '' } });
        await expect(notificationQueries.pushConfig().queryFn()).resolves.toEqual({ enabled: false, publicKey: '' });
    });
});
