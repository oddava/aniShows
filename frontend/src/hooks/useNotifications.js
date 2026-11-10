import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { notificationApi } from '../api/client';
import { notificationKeys, notificationQueries } from '../api/queries/notifications';
import { useFreshError, useReportError } from './useQueryErrorReport';

/*
 * Shared notification state. The bell badges (admin header, Navbar,
 * NotificationBell) and the /notifications page all read and write the same
 * cache entries, so marking something read in one place updates the others.
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

/** Applies `updater(flatList)` to every cached /notifications feed of this user. */
export const updateNotificationFeeds = (queryClient, userId, updater) => {
    queryClient.setQueriesData(
        { queryKey: [...notificationKeys.forUser(userId), 'feed'] },
        (data) => updateFeedItems(data, updater),
    );
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
 * list, shows as read in the feed and the badge drops by one. Callers mark only
 * unread items, as before.
 */
export function useMarkNotificationRead(userId) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (notificationId) => notificationApi.markAsRead(notificationId),
        onSuccess: (_response, notificationId) => {
            queryClient.setQueryData(
                notificationKeys.unread(userId),
                (list) => list?.filter((item) => item.id !== notificationId),
            );
            updateNotificationFeeds(queryClient, userId, (items) => items.map((item) => (
                item.id === notificationId ? { ...item, is_read: true } : item
            )));
            setUnreadNotificationCount(queryClient, userId, (count) => Math.max(0, count - 1));
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
