import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { notificationApi } from '../client';

/*
 * Notification keys. Everything sits under the signed-in user's id, so a
 * different account on the same tab never sees the previous one's counts
 * (the cache is not cleared on logout). `notificationKeys.all` matches every
 * user's notification data.
 */
export const notificationKeys = {
    all: ['notifications'],
    forUser: (userId) => ['notifications', userId ?? 'anonymous'],
    unreadCount: (userId) => ['notifications', userId ?? 'anonymous', 'unread-count'],
    /** The unread dropdown list (admin bell). */
    unread: (userId) => ['notifications', userId ?? 'anonymous', 'unread'],
    /**
     * The /notifications page feed (infinite). `category` is the server-side
     * filter; without it the key is the same as before.
     */
    feed: (userId, pageSize, category) => (
        category
            ? ['notifications', userId ?? 'anonymous', 'feed', pageSize, category]
            : ['notifications', userId ?? 'anonymous', 'feed', pageSize]
    ),
    preferences: (userId) => ['notifications', userId ?? 'anonymous', 'preferences'],
    /** This user's push devices. */
    devices: (userId) => ['notifications', userId ?? 'anonymous', 'devices'],
    /** Server push config (`{enabled, public_key}`), the same for everyone. */
    pushConfig: () => ['notifications', 'push-config'],
};

/** The page number in a DRF `next` link, or null. */
export const parseNextPageNumber = (nextUrl) => {
    if (!nextUrl) return null;
    try {
        const url = new URL(nextUrl, window.location.origin);
        const page = Number(url.searchParams.get('page'));
        if (Number.isFinite(page) && page > 1) return page;
    } catch {
        return null;
    }
    return null;
};

export const notificationQueries = {
    unreadCount: (userId) => queryOptions({
        queryKey: notificationKeys.unreadCount(userId),
        queryFn: () => notificationApi.getUnreadCount().then((response) => response.data?.count ?? 0),
    }),
    unread: (userId) => queryOptions({
        queryKey: notificationKeys.unread(userId),
        queryFn: () => notificationApi.getAll({ is_read: false }).then((response) => response.data.results || []),
    }),
    feed: (userId, pageSize, category) => infiniteQueryOptions({
        queryKey: notificationKeys.feed(userId, pageSize, category),
        queryFn: ({ pageParam }) => notificationApi
            .getAll(category
                ? { page_size: pageSize, page: pageParam, category }
                : { page_size: pageSize, page: pageParam })
            .then((response) => response.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => parseNextPageNumber(lastPage?.next || null),
    }),
    preferences: (userId) => queryOptions({
        queryKey: notificationKeys.preferences(userId),
        queryFn: () => notificationApi.getPreferences().then((response) => response.data),
    }),
    devices: (userId) => queryOptions({
        queryKey: notificationKeys.devices(userId),
        queryFn: () => notificationApi.getSubscriptions().then((response) => {
            const data = response.data;
            if (Array.isArray(data)) return data;
            return Array.isArray(data?.results) ? data.results : [];
        }),
    }),
    pushConfig: () => queryOptions({
        queryKey: notificationKeys.pushConfig(),
        queryFn: () => notificationApi.getPushConfig().then((response) => ({
            enabled: Boolean(response.data?.enabled && response.data?.public_key),
            publicKey: response.data?.public_key || '',
        })),
        staleTime: 5 * 60 * 1000,
    }),
};
