import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { adminKeys, adminListUrl, adminQueries } from '../admin';
import {
    notificationImageQueries,
    notificationKeys,
    notificationQueries,
    parseNextPageNumber,
} from '../notifications';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    getUnreadCount: vi.fn(),
    getAll: vi.fn(),
    getPreferences: vi.fn(),
    getBySlug: vi.fn(),
    getByUsername: vi.fn(),
}));

vi.mock('../../client', () => ({
    default: { get: mocks.get },
    adminBadgeApi: {},
    notificationApi: {
        getUnreadCount: mocks.getUnreadCount,
        getAll: mocks.getAll,
        getPreferences: mocks.getPreferences,
    },
    animeApi: { getBySlug: mocks.getBySlug },
    authApi: { getByUsername: mocks.getByUsername },
}));

beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

describe('adminKeys', () => {
    it('nests every admin key under its resource', () => {
        expect(adminKeys.all).toEqual(['admin']);
        expect(adminKeys.resource('users')).toEqual(['admin', 'users']);
        expect(adminKeys.list('users', { page: 2 })).toEqual(['admin', 'users', 'list', { page: 2 }]);
        expect(adminKeys.stats('favorites')).toEqual(['admin', 'favorites', 'stats']);
        expect(adminKeys.dashboard()).toEqual(['admin', 'dashboard']);
        expect(adminKeys.settings()).toEqual(['admin', 'settings']);
        expect(adminKeys.report('users', '30')).toEqual(['admin', 'reports', 'users', '30']);
    });

    it('invalidates a whole resource (lists and stats) and nothing else', async () => {
        const client = new QueryClient();
        const keys = {
            favPage1: adminKeys.list('favorites', { page: 1 }),
            favFiltered: adminKeys.list('favorites', { page: 3, user: 'x' }),
            favStats: adminKeys.stats('favorites'),
            reviews: adminKeys.list('reviews', { page: 1 }),
            reports: adminKeys.list('reviews/reports', { page: 1, min_score: '1' }),
        };
        Object.values(keys).forEach((key) => client.setQueryData(key, {}));

        await client.invalidateQueries({ queryKey: adminKeys.resource('favorites') });
        const invalidated = (key) => client.getQueryState(key).isInvalidated;
        expect(invalidated(keys.favPage1)).toBe(true);
        expect(invalidated(keys.favFiltered)).toBe(true);
        expect(invalidated(keys.favStats)).toBe(true);
        expect(invalidated(keys.reviews)).toBe(false);

        // 'reviews' and 'reviews/reports' are separate resources.
        await client.invalidateQueries({ queryKey: adminKeys.resource('reviews') });
        expect(invalidated(keys.reviews)).toBe(true);
        expect(invalidated(keys.reports)).toBe(false);
    });

    it('builds list URLs the way the pages always did', () => {
        expect(adminListUrl('users', { page: 1, search: 'a b', ordering: '-date_joined' }))
            .toBe('/admin/users/?page=1&search=a+b&ordering=-date_joined');
        expect(adminListUrl('reviews/reports', { page: 2, min_score: '1' }))
            .toBe('/admin/reviews/reports/?page=2&min_score=1');
    });

    it('fetches lists, stats, dashboard and settings and resolves to the body', async () => {
        mocks.get.mockResolvedValue({ data: { body: true } });
        const signal = new AbortController().signal;

        await expect(adminQueries.list('genres', { page: 1 }).queryFn({ signal })).resolves.toEqual({ body: true });
        expect(mocks.get).toHaveBeenLastCalledWith('/admin/genres/?page=1', { signal });

        await adminQueries.stats('logs').queryFn({ signal });
        expect(mocks.get).toHaveBeenLastCalledWith('/admin/logs/stats/', { signal });
        await adminQueries.dashboard().queryFn({ signal });
        expect(mocks.get).toHaveBeenLastCalledWith('/admin/dashboard/', { signal });
        await adminQueries.settings().queryFn({ signal });
        expect(mocks.get).toHaveBeenLastCalledWith('/admin/settings/', { signal });
    });
});

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

    it('looks up images and resolves a failed lookup to null', async () => {
        mocks.getBySlug.mockResolvedValue({ data: { cover_image_medium: 'm.jpg', cover_image: 'c.jpg' } });
        await expect(notificationImageQueries.animeCover('x').queryFn()).resolves.toBe('m.jpg');
        mocks.getBySlug.mockRejectedValue(new Error('404'));
        await expect(notificationImageQueries.animeCover('x').queryFn()).resolves.toBeNull();

        mocks.getByUsername.mockResolvedValue({ data: { avatar: 'a.png' } });
        await expect(notificationImageQueries.userAvatar('u').queryFn()).resolves.toBe('a.png');
        mocks.getByUsername.mockRejectedValue(new Error('404'));
        await expect(notificationImageQueries.userAvatar('u').queryFn()).resolves.toBeNull();
    });
});
