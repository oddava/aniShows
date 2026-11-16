import React, { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Loader2, LogIn } from 'lucide-react';

import { notificationKeys, notificationQueries } from '../api/queries/notifications';
import ErrorState from '../components/common/ErrorState';
import PageLoader from '../components/common/PageLoader';
import SEO from '../components/SEO';
import { useAuth } from '../context/AuthContext';
import {
    flattenFeed,
    updateNotificationFeeds,
    useDeleteNotification,
    useMarkAllNotificationsRead,
    useMarkNotificationRead,
    useUnreadNotificationCount,
} from '../hooks/useNotifications';
import { useFreshError, useReportError } from '../hooks/useQueryErrorReport';
import logger from '../utils/logger';
import { getNotificationTarget } from '../utils/notificationUtils';
import NotificationItem from '../components/notifications/NotificationItem';
import { useNotificationSocket } from '../components/notifications/notificationSocket';

/** Chips map to the API's server-side `category=` filter. */
const NOTIFICATION_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'episodes', label: 'Episodes' },
    { value: 'replies', label: 'Replies' },
    { value: 'likes', label: 'Likes' },
    { value: 'follows', label: 'Follows' },
    { value: 'account', label: 'Account' },
];

const EMPTY_STATES = {
    all: {
        title: 'No notifications yet.',
        hint: 'New episodes of shows you’re watching, replies, likes and follows show up here.',
    },
    episodes: {
        title: 'No episode alerts yet.',
        hint: 'Add airing shows to Watching to get them.',
    },
    replies: {
        title: 'No replies or mentions yet.',
        hint: 'Replies to your forum posts and @mentions show up here.',
    },
    likes: {
        title: 'No likes yet.',
        hint: 'Likes on your reviews and posts show up here.',
    },
    follows: {
        title: 'No new followers yet.',
        hint: 'When someone follows you, it shows up here.',
    },
    account: {
        title: 'No account notifications yet.',
        hint: 'Badges and announcements show up here.',
    },
};

const PAGE_SIZE = 30;

/** Whether a notification belongs in a feed filtered to `category`. */
const fitsFeed = (notification, category) => !category || notification?.category === category;

const sortNewestFirst = (items) => [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
);

function FeedSkeleton() {
    return (
        <div className="mt-4 sm:mt-5 w-full space-y-2.5 sm:space-y-3.5" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex overflow-hidden rounded-md bg-dark-100/80">
                    <div className="w-14 h-20 sm:w-16 sm:h-24 flex-shrink-0 animate-pulse bg-dark-50" />
                    <div className="flex-1 px-3 sm:px-4 py-3 space-y-2">
                        <div className="h-3.5 w-3/4 rounded animate-pulse bg-dark-50" />
                        <div className="h-3.5 w-1/2 rounded animate-pulse bg-dark-50" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function Notifications() {
    const { user, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const queryClient = useQueryClient();
    const userId = user?.id;
    const [activeFilter, setActiveFilter] = useState('all');
    const [actionError, setActionError] = useState('');
    const category = activeFilter === 'all' ? undefined : activeFilter;

    // Every visit starts from page 1 (gcTime 0), as it did when the list lived in state.
    const feedKey = notificationKeys.feed(userId, PAGE_SIZE, category);
    const feedQuery = useInfiniteQuery({
        ...notificationQueries.feed(userId, PAGE_SIZE, category),
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

    // Read only: the navbar owns the fetch; the socket keeps it current.
    const { data: unreadCount = 0 } = useUnreadNotificationCount(userId, { enabled: false });

    const retryFeed = useCallback(() => (
        // Back to page 1 with the skeleton, like the old Retry.
        queryClient.resetQueries({ queryKey: feedKey, exact: true })
    ), [feedKey, queryClient]);

    const markReadMutation = useMarkNotificationRead(userId);
    const markAllReadMutation = useMarkAllNotificationsRead(userId);
    const deleteMutation = useDeleteNotification(userId);
    const markingAllRead = markAllReadMutation.isPending;
    const { mutateAsync: markOneRead } = markReadMutation;
    const { mutateAsync: markAllRead } = markAllReadMutation;
    const { mutateAsync: deleteOne } = deleteMutation;
    const deletingId = deleteMutation.isPending ? deleteMutation.variables : null;

    const markNotificationRead = useCallback(async (notification) => {
        if (notification.is_read) return;
        await markOneRead(notification.id);
    }, [markOneRead]);

    const handleWsMessage = useCallback((data) => {
        const setNotifications = (updater) => updateNotificationFeeds(queryClient, userId, updater);

        if (data.type === 'notification' && data.notification) {
            setNotifications((prev, feedCategory) => {
                if (!fitsFeed(data.notification, feedCategory)) return prev;
                if (prev.some((item) => item.id === data.notification.id)) return prev;
                return [data.notification, ...prev];
            });
            return;
        }

        if (data.type === 'notification_updated' && data.notification) {
            setNotifications((prev, feedCategory) => {
                const hasExisting = prev.some((item) => item.id === data.notification.id);
                if (!hasExisting && !fitsFeed(data.notification, feedCategory)) return prev;
                const merged = hasExisting
                    ? prev.map((item) => (item.id === data.notification.id ? { ...item, ...data.notification } : item))
                    : [data.notification, ...prev];
                return sortNewestFirst(merged);
            });
            return;
        }

        if (data.type === 'notification_read' && data.notification_id) {
            setNotifications((prev) => (
                prev.some((item) => item.id === data.notification_id && !item.is_read)
                    ? prev.map((item) => (item.id === data.notification_id ? { ...item, is_read: true } : item))
                    : prev
            ));
            return;
        }

        if (data.type === 'notification_deleted' && data.notification_id) {
            setNotifications((prev) => (
                prev.some((item) => item.id === data.notification_id)
                    ? prev.filter((item) => item.id !== data.notification_id)
                    : prev
            ));
        }
    }, [queryClient, userId]);

    // The same socket as the navbar's (one per tab).
    useNotificationSocket({
        userId,
        queryClient,
        onMessage: handleWsMessage,
        enabled: Boolean(isAuthenticated && userId != null),
    });

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

    const handleDelete = useCallback(async (notification) => {
        setActionError('');
        try {
            await deleteOne(notification.id);
        } catch (error) {
            logger.error('Failed to delete notification:', error);
            setActionError('Could not delete this notification.');
        }
    }, [deleteOne]);

    const { fetchNextPage } = feedQuery;
    const handleLoadMore = useCallback(async () => {
        if (!nextPage || loadingMore) return;
        await fetchNextPage();
    }, [fetchNextPage, loadingMore, nextPage]);

    const hasUnread = unreadCount > 0 || notifications.some((item) => !item.is_read);

    if (authLoading) {
        return <PageLoader />;
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

    const emptyState = EMPTY_STATES[activeFilter] || EMPTY_STATES.all;
    let content;
    if (loadingInitial) {
        content = <FeedSkeleton />;
    } else if (feedError && notifications.length === 0) {
        content = (
            <ErrorState
                className="mt-4 sm:mt-5"
                title="Couldn’t load notifications"
                message="Check your connection and try again."
                onRetry={retryFeed}
            />
        );
    } else if (notifications.length === 0) {
        content = (
            <div className="min-h-[40vh] flex flex-col items-center justify-center text-center text-gray-400 px-4">
                <Bell aria-hidden="true" className="w-10 h-10 mb-3 text-gray-600" />
                <p className="text-sm text-gray-300">{emptyState.title}</p>
                <p className="text-sm text-gray-500 mt-1">{emptyState.hint}</p>
            </div>
        );
    } else {
        content = (
            <>
                {feedError && (
                    <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-center justify-between gap-3">
                        <span>Failed to load notifications. Please try again.</span>
                        <button
                            type="button"
                            onClick={retryFeed}
                            className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70"
                        >
                            Retry
                        </button>
                    </div>
                )}
                <ul className="mt-4 sm:mt-5 w-full space-y-2.5 sm:space-y-3.5">
                    {notifications.map((notification, index) => (
                        <li key={notification.id}>
                            <NotificationItem
                                notification={notification}
                                index={index}
                                handleNotificationOpen={handleNotificationOpen}
                                markNotificationRead={markNotificationRead}
                                setActionError={setActionError}
                                navigate={navigate}
                                onDelete={handleDelete}
                                isDeleting={deletingId === notification.id}
                            />
                        </li>
                    ))}
                </ul>
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
                                    <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                                    Loading
                                </>
                            ) : (
                                'Load more'
                            )}
                        </button>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-4 py-5 sm:py-6">
            <SEO page="notifications" noIndex />

            <div className="mb-4 sm:mb-5 flex items-center justify-between gap-3">
                <h1 className="page-title">Notifications</h1>
                <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    disabled={!hasUnread || markingAllRead}
                    className="text-xs sm:text-sm px-2.5 py-1.5 rounded-lg bg-dark-100 text-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                >
                    {markingAllRead ? 'Marking...' : 'Mark all read'}
                </button>
            </div>

            {actionError && (
                <div role="alert" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    {actionError}
                </div>
            )}

            <div className="overflow-x-auto scrollbar-hide w-full">
                <div className="inline-flex items-center gap-1.5 min-w-max" role="group" aria-label="Filter notifications">
                    {NOTIFICATION_FILTERS.map((filter) => (
                        <button
                            key={filter.value}
                            type="button"
                            aria-pressed={activeFilter === filter.value}
                            onClick={() => setActiveFilter(filter.value)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${activeFilter === filter.value
                                ? 'bg-accent-dark text-white'
                                : 'bg-dark-100 text-gray-300 hover:text-white'
                                }`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
            </div>

            {content}
        </div>
    );
}
