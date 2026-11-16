import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { notificationApi } from '../api/client';
import { notificationKeys, notificationQueries } from '../api/queries/notifications';
import { useFreshError, useReportError } from './useQueryErrorReport';

/*
 * Shared notification state. The bell badges (admin header, Navbar) and the
 * /notifications page all read and write the same cache entries, so marking
 * something read in one place updates the others.
 */

const dedupeById = (items) => {
    const seen = new Set();
    return items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
};

/** The feed's pages as one list, without the duplicates paging can produce. */
export const flattenFeed = (data) => dedupeById((data?.pages || []).flatMap((page) => page?.results || []));

/**
 * Applies `updater(flatList) => flatList` to cached feed data and puts the
 * result back into pages. Later pages keep their sizes; the first page absorbs
 * additions and removals (new notifications are the newest, so they belong
 * there). Each page's `next` link is untouched, so "Load more" keeps working.
 */
export const updateFeedItems = (data, updater) => {
    if (!data?.pages?.length) return data;
    const flat = flattenFeed(data);
    const next = updater(flat);
    if (next === flat) return data;

    const tailSizes = data.pages.slice(1).map((page) => (page?.results || []).length);
    const headSize = Math.max(0, next.length - tailSizes.reduce((sum, size) => sum + size, 0));
    let offset = headSize;
    const pages = data.pages.map((page, index) => {
        if (index === 0) return { ...page, results: next.slice(0, headSize) };
        const size = tailSizes[index - 1];
        const results = next.slice(offset, offset + size);
        offset += size;
        return { ...page, results };
    });
    return { ...data, pages };
};

/** Writes the unread badge count (a number, or `(current) => number`). */
export const setUnreadNotificationCount = (queryClient, userId, countOrUpdater) => {
    queryClient.setQueryData(notificationKeys.unreadCount(userId), (current) => (
        typeof countOrUpdater === 'function' ? countOrUpdater(current ?? 0) : countOrUpdater
    ));
};

/**
 * Applies `updater(flatList, category)` to every cached /notifications feed of
 * this user. `category` is the feed's server-side filter (undefined for All),
 * so an updater can keep, say, a reply out of the Episodes feed.
 */
export const updateNotificationFeeds = (queryClient, userId, updater) => {
    const feedPrefix = [...notificationKeys.forUser(userId), 'feed'];
    queryClient.getQueriesData({ queryKey: feedPrefix }).forEach(([queryKey, data]) => {
        const category = queryKey[feedPrefix.length + 1];
        const next = updateFeedItems(data, (items) => updater(items, category));
        if (next !== data) queryClient.setQueryData(queryKey, next);
    });
};

/** The server's unread count from a mutation response, when it sent one. */
const unreadCountFrom = (response) => {
    const count = response?.data?.unread_count;
    return typeof count === 'number' ? count : null;
};

/**
 * The unread badge count. Defaults: refetch on every mount (staleTime 0), one
 * attempt per fetch, failures logged with `errorLog`. Pass `enabled: false` to
 * only read what others (e.g. WebSocket pushes) wrote.
 */
export function useUnreadNotificationCount(userId, { errorLog, ...options } = {}) {
    const query = useQuery({
        ...notificationQueries.unreadCount(userId),
        staleTime: 0,
        retry: false,
        ...options,
    });
    const error = useFreshError(query, notificationKeys.unreadCount(userId));
    useReportError(error, query.errorUpdatedAt, { log: errorLog });
    return query;
}

/**
 * The unread notifications for a dropdown. Pass `enabled: isOpen`: it fetches
 * each time the dropdown opens, like the old open-handler did.
 */
export function useUnreadNotifications(userId, { errorLog, ...options } = {}) {
    const query = useQuery({
        ...notificationQueries.unread(userId),
        staleTime: 0,
        retry: false,
        ...options,
    });
    const error = useFreshError(query, notificationKeys.unread(userId));
    useReportError(error, query.errorUpdatedAt, { log: errorLog });
    return query;
}

/**
 * Marks one notification read (`mutate(id)`). On success it leaves the unread
 * list, shows as read in the feed and the badge takes the server's new count
 * (or drops by one when the response has none).
 */
export function useMarkNotificationRead(userId) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (notificationId) => notificationApi.markAsRead(notificationId),
        onSuccess: (response, notificationId) => {
            queryClient.setQueryData(
                notificationKeys.unread(userId),
                (list) => list?.filter((item) => item.id !== notificationId),
            );
            updateNotificationFeeds(queryClient, userId, (items) => items.map((item) => (
                item.id === notificationId ? { ...item, is_read: true } : item
            )));
            const serverCount = unreadCountFrom(response);
            setUnreadNotificationCount(
                queryClient,
                userId,
                serverCount ?? ((count) => Math.max(0, count - 1)),
            );
        },
    });
}

/**
 * Deletes one notification (`mutate(id)`): it leaves every feed and the unread
 * list, and the badge is refetched so it shows the server's count.
 */
export function useDeleteNotification(userId) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (notificationId) => notificationApi.delete(notificationId),
        onSuccess: (_response, notificationId) => {
            queryClient.setQueryData(
                notificationKeys.unread(userId),
                (list) => list?.filter((item) => item.id !== notificationId),
            );
            updateNotificationFeeds(queryClient, userId, (items) => {
                const next = items.filter((item) => item.id !== notificationId);
                return next.length === items.length ? items : next;
            });
            queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(userId), exact: true });
        },
    });
}

/** Marks everything read: the unread list empties, the feed shows all read, the badge goes to 0. */
export function useMarkAllNotificationsRead(userId) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => notificationApi.markAllAsRead(),
        onSuccess: () => {
            queryClient.setQueryData(notificationKeys.unread(userId), (list) => (list ? [] : list));
            updateNotificationFeeds(queryClient, userId, (items) => items.map((item) => ({ ...item, is_read: true })));
            setUnreadNotificationCount(queryClient, userId, 0);
        },
    });
}
