import React, { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';

import { notificationKeys, notificationQueries } from '../api/queries/notifications';
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
import useActivePill from '../hooks/useActivePill';

/** Chips map to the API's server-side `category=` filter. */
const NOTIFICATION_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'episodes', label: 'Episodes' },
    { value: 'replies', label: 'Replies' },
    { value: 'likes', label: 'Likes' },
    { value: 'follows', label: 'Follows' },
    { value: 'account', label: 'Account' },
];

/** One plain sentence per filter when there is nothing to show. */
const EMPTY_STATES = {
    all: 'No notifications yet. New episodes, replies, likes and follows will show up here.',
    episodes: 'No episode alerts yet. Add airing shows to Watching to get them.',
    replies: 'No replies or mentions yet.',
    likes: 'No likes on your reviews or posts yet.',
    follows: 'No new followers yet.',
    account: 'No badges or announcements yet.',
};

const PAGE_SIZE = 30;

/** Whether a notification belongs in a feed filtered to `category`. */
const fitsFeed = (notification, category) => !category || notification?.category === category;

const sortNewestFirst = (items) => [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
);

function FeedSkeleton() {
    return (
        <div className="mt-4 space-y-1" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex items-center gap-4 py-3">
                    <div className="h-[72px] w-12 shrink-0 animate-pulse rounded-[var(--radius-sm)] bg-white/[0.05]" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.05]" />
                        <div className="h-3.5 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** A failed load said plainly, with a retry that refetches in place. */
function FeedError({ message, onRetry }) {
    const [retrying, setRetrying] = useState(false);
    const retry = async () => {
        if (retrying) return;
        setRetrying(true);
        try {
            await onRetry();
        } finally {
            setRetrying(false);
        }
    };
    return (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-x-3 text-sm text-[var(--text-2)]">
            <span>{message}</span>
            <button type="button" onClick={retry} disabled={retrying} className="text-link">
                {retrying ? 'Trying again' : 'Try again'}
            </button>
        </div>
    );
}

export default function Notifications() {
    const { user, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const queryClient = useQueryClient();
    const userId = user?.id;
    const [activeFilter, setActiveFilter] = useState('all');
    const filterPill = useActivePill();
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
            <div className="page-container pt-6 pb-16 md:pt-10">
                <SEO page="notifications" noIndex />
                <h1 className="page-title">Notifications</h1>
                <p className="mt-2 text-sm text-[var(--text-2)]">Sign in to see your notifications.</p>
                <Link to="/login" className="btn-primary mt-5 text-sm">Sign in</Link>
            </div>
        );
    }

    const emptyState = EMPTY_STATES[activeFilter] || EMPTY_STATES.all;
    let content;
    if (loadingInitial) {
        content = <FeedSkeleton />;
    } else if (feedError && notifications.length === 0) {
        content = <FeedError message="Couldn’t load notifications. Check your connection." onRetry={retryFeed} />;
    } else if (notifications.length === 0) {
        content = <p className="mt-6 text-sm text-[var(--text-2)]">{emptyState}</p>;
    } else {
        content = (
            <>
                {feedError && <FeedError message="Couldn’t load the latest notifications." onRetry={retryFeed} />}
                <ul className="-mx-3 mt-4 space-y-1">
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
                    <div className="mt-6">
                        <button
                            type="button"
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="btn-secondary text-sm"
                        >
                            {loadingMore ? 'Loading' : 'Load more'}
                        </button>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="page-container pt-6 pb-16 md:pt-10">
            <SEO page="notifications" noIndex />

            <div className="max-w-3xl">
                <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                    <div>
                        <h1 className="page-title">Notifications</h1>
                        <p className="mt-1 text-sm text-[var(--text-2)] tabular">
                            {unreadCount > 0 ? `${unreadCount} unread` : 'New episodes, replies, likes and follows.'}
                        </p>
                    </div>
                    {(hasUnread || markingAllRead) && (
                        <button
                            type="button"
                            onClick={handleMarkAllAsRead}
                            disabled={markingAllRead}
                            className="btn-ghost -mr-3 text-sm"
                        >
                            {markingAllRead ? 'Marking…' : 'Mark all read'}
                        </button>
                    )}
                </header>

                {actionError && (
                    <p role="alert" className="mt-4 rounded-[var(--radius-md)] bg-white/[0.04] px-3 py-2 text-sm text-[var(--text-1)]">
                        {actionError}
                    </p>
                )}

                <div className="scroll-fade -mx-4 mt-6 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
                    <div ref={filterPill.hostRef} className="pill-host flex min-w-max gap-1" role="group" aria-label="Filter notifications">
                        <span ref={filterPill.pillRef} aria-hidden="true" className="active-pill" />
                        {NOTIFICATION_FILTERS.map((filter) => {
                            const active = activeFilter === filter.value;
                            return (
                                <button
                                    key={filter.value}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setActiveFilter(filter.value)}
                                    className={`press flex min-h-11 items-center rounded-lg px-3.5 text-sm font-semibold transition-colors duration-150 md:min-h-9 ${active
                                        ? 'bg-white/[0.07] text-[var(--text-1)]'
                                        : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {content}
            </div>
        </div>
    );
}
