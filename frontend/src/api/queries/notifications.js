import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { authApi, animeApi, notificationApi } from '../client';

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
    /** The unread dropdown list (admin bell, NotificationBell). */
    unread: (userId) => ['notifications', userId ?? 'anonymous', 'unread'],
    /** The /notifications page feed (infinite). */
    feed: (userId, pageSize) => ['notifications', userId ?? 'anonymous', 'feed', pageSize],
    preferences: (userId) => ['notifications', userId ?? 'anonymous', 'preferences'],
};

/** Images the /notifications page looks up for items without an embedded one. */
export const notificationImageKeys = {
    animeCover: (slug) => ['notificationImages', 'animeCover', slug],
    userAvatar: (username) => ['notificationImages', 'userAvatar', username],
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
    feed: (userId, pageSize) => infiniteQueryOptions({
        queryKey: notificationKeys.feed(userId, pageSize),
        queryFn: ({ pageParam }) => notificationApi
            .getAll({ page_size: pageSize, page: pageParam })
            .then((response) => response.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => parseNextPageNumber(lastPage?.next || null),
    }),
    preferences: (userId) => queryOptions({
        queryKey: notificationKeys.preferences(userId),
        queryFn: () => notificationApi.getPreferences().then((response) => response.data),
    }),
};

// A failed lookup resolves to null (no image), as the page always did.
export const notificationImageQueries = {
    animeCover: (slug) => queryOptions({
        queryKey: notificationImageKeys.animeCover(slug),
        queryFn: () => animeApi.getBySlug(slug).then(
            (response) => {
                const anime = response.data || {};
                return anime.cover_image_small || anime.cover_image_medium || anime.cover_image || null;
            },
            () => null,
        ),
        staleTime: Infinity,
    }),
    userAvatar: (username) => queryOptions({
        queryKey: notificationImageKeys.userAvatar(username),
        queryFn: () => authApi.getByUsername(username).then(
            (response) => response.data?.avatar || null,
            () => null,
        ),
        staleTime: Infinity,
    }),
};
