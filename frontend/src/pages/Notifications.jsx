import React, { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Loader2, LogIn } from 'lucide-react';

import {
    notificationImageQueries,
    notificationKeys,
    notificationQueries,
} from '../api/queries/notifications';
import SEO from '../components/SEO';
import { useAuth } from '../context/AuthContext';
import {
    flattenFeed,
    updateNotificationFeeds,
    useMarkAllNotificationsRead,
    useMarkNotificationRead,
} from '../hooks/useNotifications';
import { useFreshError, useReportError } from '../hooks/useQueryErrorReport';
import { useWebSocket } from '../hooks/useWebSocket';
import logger from '../utils/logger';
import { getNotificationTarget } from '../utils/notificationUtils';
import NotificationItem from '../components/notifications/NotificationItem';
import { getAnimeSlug, hasEmbeddedImage } from '../components/notifications/notificationDisplay';

const NOTIFICATION_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'new_episode', label: 'Episodes' },
    { value: 'review_reply', label: 'Review Replies' },
    { value: 'review_like', label: 'Review Likes' },
    { value: 'new_follower', label: 'Followers' },
    { value: 'forum', label: 'Forum' },
    { value: 'badge_awarded', label: 'Badges' },
    { value: 'system', label: 'System' },
];

const FORUM_FILTER_TYPES = new Set(['forum_reply', 'forum_mention', 'forum_like']);
const PAGE_SIZE = 30;

// Image lookups stay bounded, as before: covers for the first 24 items, 12 requests at a time; avatars 8 at a time.
const COVER_LOOKUP_ITEMS = 24;
const COVER_BATCH = 12;
const AVATAR_BATCH = 8;

/** Fetches `queryOptionsFor(name)` for each name, `batchSize` at a time, into `{ name: value }`. */
const fetchInBatches = async (queryClient, names, batchSize, queryOptionsFor) => {
    const result = {};
    for (let index = 0; index < names.length; index += batchSize) {
        const batch = names.slice(index, index + batchSize);
        const values = await Promise.all(batch.map((name) => queryClient.fetchQuery(queryOptionsFor(name))));
        batch.forEach((name, offset) => {
            result[name] = values[offset];
        });
    }
    return result;
};

const EMPTY_MAP = {};

export default function Notifications() {
    const { user, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const queryClient = useQueryClient();
    const userId = user?.id;
    const [activeFilter, setActiveFilter] = useState('all');
    const [actionError, setActionError] = useState('');
    const [brokenThumbIds, setBrokenThumbIds] = useState(new Set());

    // Every visit starts from page 1 (gcTime 0), as it did when the list lived in state.
    const feedKey = notificationKeys.feed(userId, PAGE_SIZE);
    const feedQuery = useInfiniteQuery({
        ...notificationQueries.feed(userId, PAGE_SIZE),
        enabled: isAuthenticated,
        staleTime: 0,
        gcTime: 0,
        retry: false,
    });
    const feedError = useFreshError(feedQuery, feedKey);
    useReportError(feedError, feedQuery.errorUpdatedAt, { log: 'Failed to fetch notifications:' });

    const notifications = useMemo(() => flattenFeed(feedQuery.data), [feedQuery.data]);
    const loadingInitial = feedQuery.isLoading;
    const loadingMore = feedQuery.isFetchingNextPage;
    const nextPage = feedQuery.hasNextPage;
    const fetchError = feedError ? 'Failed to load notifications. Please try again.' : '';

    const retryFeed = useCallback(() => {
        // Back to page 1 with the spinner, like the old Retry.
        queryClient.resetQueries({ queryKey: notificationKeys.feed(userId, PAGE_SIZE), exact: true });
    }, [queryClient, userId]);

    const markReadMutation = useMarkNotificationRead(userId);
    const markAllReadMutation = useMarkAllNotificationsRead(userId);
    const markingAllRead = markAllReadMutation.isPending;
    const { mutateAsync: markOneRead } = markReadMutation;
    const { mutateAsync: markAllRead } = markAllReadMutation;

    const markNotificationRead = useCallback(async (notification) => {
        if (notification.is_read) return;
        await markOneRead(notification.id);
    }, [markOneRead]);

    // Covers for anime notifications that carry no image of their own.
    const coverSlugs = useMemo(() => Array.from(
        new Set(
            notifications
                .slice(0, COVER_LOOKUP_ITEMS)
                .map((item) => (hasEmbeddedImage(item) ? null : getAnimeSlug(item)))
                .filter(Boolean)
        )
    ), [notifications]);
    const { data: coverBySlug = EMPTY_MAP } = useQuery({
        queryKey: ['notificationImages', 'covers', coverSlugs],
        queryFn: () => fetchInBatches(queryClient, coverSlugs, COVER_BATCH, notificationImageQueries.animeCover),
        enabled: coverSlugs.length > 0,
        staleTime: Infinity,
        placeholderData: keepPreviousData,
    });

    // Avatars for follower notifications.
    const followerUsernames = useMemo(() => Array.from(
        new Set(
            notifications
                .filter((item) => item.notification_type === 'new_follower')
                .map((item) => item?.data?.follower_username)
                .filter((username) => typeof username === 'string' && username.trim().length > 0)
        )
    ), [notifications]);
    const { data: followerAvatarByUsername = EMPTY_MAP } = useQuery({
        queryKey: ['notificationImages', 'avatars', followerUsernames],
        queryFn: () => fetchInBatches(queryClient, followerUsernames, AVATAR_BATCH, notificationImageQueries.userAvatar),
        enabled: followerUsernames.length > 0,
        staleTime: Infinity,
        placeholderData: keepPreviousData,
    });

    const handleWsMessage = useCallback((data) => {
        const setNotifications = (updater) => updateNotificationFeeds(queryClient, userId, updater);

        if (data.type === 'notification' && data.notification) {
            setNotifications((prev) => {
                const exists = prev.some((item) => item.id === data.notification.id);
                if (exists) return prev;
                return [data.notification, ...prev];
            });
            return;
        }

        if (data.type === 'notification_updated' && data.notification) {
            setNotifications((prev) => {
                const hasExisting = prev.some((item) => item.id === data.notification.id);
                const merged = hasExisting
                    ? prev.map((item) => (item.id === data.notification.id ? data.notification : item))
                    : [data.notification, ...prev];
                return [...merged].sort(
                    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
            });
            return;
        }

        if (data.type === 'notification_read' && data.notification_id) {
            setNotifications((prev) => prev.map((item) => (
                item.id === data.notification_id ? { ...item, is_read: true } : item
            )));
            return;
        }

        if (data.type === 'notification_deleted' && data.notification_id) {
            setNotifications((prev) => prev.filter((item) => item.id !== data.notification_id));
        }
    }, [queryClient, userId]);

    useWebSocket(
        user ? '/ws/notifications/' : null,
        { onMessage: handleWsMessage },
        { autoConnect: !!user }
    );

    const handleNotificationOpen = useCallback(async (notification) => {
        const target = getNotificationTarget(notification);
        setActionError('');

        if (!notification.is_read) {
            try {
                await markNotificationRead(notification);
            } catch (error) {
                logger.error('Failed to mark notification as read:', error);
                setActionError('Could not update read status for this notification.');
            }
        }

        if (target) navigate(target);
    }, [markNotificationRead, navigate]);

    const handleMarkAllAsRead = useCallback(async () => {
        setActionError('');
        try {
            // Also zeroes the shared unread badge (Navbar).
            await markAllRead();
        } catch (error) {
            logger.error('Failed to mark all notifications as read:', error);
            setActionError('Could not mark all notifications as read.');
        }
    }, [markAllRead]);

    const { fetchNextPage } = feedQuery;
    const handleLoadMore = useCallback(async () => {
        if (!nextPage || loadingMore) return;
        await fetchNextPage();
    }, [fetchNextPage, loadingMore, nextPage]);

    const hasUnread = notifications.some((item) => !item.is_read);
    const filteredNotifications = notifications.filter((item) => {
        if (activeFilter === 'all') return true;
        if (activeFilter === 'forum') return FORUM_FILTER_TYPES.has(item.notification_type);
        return item.notification_type === activeFilter;
    });

    if (authLoading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center px-4">
                <div className="flex items-center gap-3 text-gray-300">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading notifications...</span>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
                <SEO page="notifications" noIndex />
                <div className="rounded-2xl border border-gray-800 bg-dark-100/80 p-8 text-center">
                    <Bell className="w-12 h-12 mx-auto text-gray-500 mb-4" />
                    <h1 className="text-2xl font-semibold text-white">Notifications</h1>
                    <p className="text-gray-400 mt-2 mb-6">Sign in to see your notifications.</p>
                    <Link to="/login" className="inline-flex items-center gap-2 btn-primary">
                        <LogIn className="w-4 h-4" />
                        Sign in
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-4 py-5 sm:py-6">
            <SEO page="notifications" noIndex />

            {loadingInitial ? (
                <div className="min-h-[40vh] flex items-center justify-center text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                </div>
            ) : (
                <>
                    {fetchError && (
                        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-center justify-between gap-3">
                            <span>{fetchError}</span>
                            <button
                                type="button"
                                onClick={retryFeed}
                                className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {actionError && (
                        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                            {actionError}
                        </div>
                    )}

                    <div className="mb-6 sm:mb-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="overflow-x-auto scrollbar-hide w-full sm:w-auto">
                            <div className="inline-flex items-center gap-1.5 min-w-max">
                                {NOTIFICATION_FILTERS.map((filter) => (
                                    <button
                                        key={filter.value}
                                        type="button"
                                        onClick={() => setActiveFilter(filter.value)}
                                        className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm transition-colors ${activeFilter === filter.value
                                            ? 'bg-accent text-white'
                                            : 'bg-dark-100 text-gray-300 hover:text-white'
                                            }`}
                                    >
                                        {filter.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleMarkAllAsRead}
                            disabled={!hasUnread || markingAllRead}
                            className="self-end sm:self-auto text-xs sm:text-sm px-2.5 py-1.5 rounded-lg bg-dark-100 text-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                        >
                            {markingAllRead ? 'Marking...' : 'Mark all read'}
                        </button>
                    </div>

                    {filteredNotifications.length === 0 ? (
                <div className="min-h-[40vh] flex flex-col items-center justify-center text-gray-400">
                    <Bell className="w-10 h-10 mb-3 text-gray-600" />
                    <p className="text-sm text-gray-300">No notifications for this filter</p>
                </div>
            ) : (
                <>
                <div className="mt-4 sm:mt-5 w-full space-y-2.5 sm:space-y-3.5">
                    {filteredNotifications.map((notification, index) => (
                        <NotificationItem
                            key={notification.id}
                            notification={notification}
                            index={index}
                            coverBySlug={coverBySlug}
                            followerAvatarByUsername={followerAvatarByUsername}
                            brokenThumbIds={brokenThumbIds}
                            setBrokenThumbIds={setBrokenThumbIds}
                            handleNotificationOpen={handleNotificationOpen}
                            markNotificationRead={markNotificationRead}
                            setActionError={setActionError}
                            navigate={navigate}
                        />
                    ))}
                </div>
                {nextPage && (
                    <div className="mt-4 sm:mt-5 flex justify-center">
                        <button
                            type="button"
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-dark-100 text-sm text-gray-200 hover:text-white disabled:text-gray-500 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                        >
                            {loadingMore ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading
                                </>
                            ) : (
                                'Load more'
                            )}
                        </button>
                    </div>
                )}
                </>
            )}
                </>
            )}
        </div>
    );
}
