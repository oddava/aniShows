import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Bell,
    Check,
    CheckCheck,
    ChevronRight,
    Loader2,
    LogIn,
    Trash2,
} from 'lucide-react';

import { notificationApi } from '../api/client';
import SEO from '../components/SEO';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import logger from '../utils/logger';

const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread' },
];

const formatNotificationTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';

    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

const getNotificationTarget = (notification) => {
    const data = notification?.data || {};

    if (data.anime_slug) {
        return `/anime/${data.anime_slug}`;
    }
    if (notification.notification_type === 'new_follower' && data.follower_username) {
        return `/u/${data.follower_username}`;
    }
    if ((notification.notification_type === 'forum_reply' || notification.notification_type === 'forum_mention' || notification.notification_type === 'forum_like') && data.thread_id) {
        return `/forums/thread/${data.thread_id}`;
    }
    if (notification.notification_type === 'badge_awarded') {
        return '/profile';
    }

    return null;
};

export default function Notifications() {
    const { user, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const [filter, setFilter] = useState('all');
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [actionId, setActionId] = useState(null);
    const [markingAll, setMarkingAll] = useState(false);

    const isUnreadMode = filter === 'unread';
    const hasLoadedRef = useRef(false);

    const fetchUnreadCount = useCallback(async () => {
        if (!isAuthenticated) {
            setUnreadCount(0);
            return;
        }

        try {
            const response = await notificationApi.getUnreadCount();
            setUnreadCount(response.data?.count ?? 0);
        } catch (error) {
            logger.error('Failed to fetch unread notification count:', error);
        }
    }, [isAuthenticated]);

    const fetchNotifications = useCallback(async (targetPage = 1, append = false) => {
        if (!isAuthenticated) return;

        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }

        try {
            const params = {
                page: targetPage,
                page_size: 20,
            };
            if (isUnreadMode) {
                params.is_read = false;
            }

            const response = await notificationApi.getAll(params);
            const payload = response.data || {};
            const nextPageExists = Boolean(payload.next);
            const items = payload.results || [];

            setNotifications((prev) => (append ? [...prev, ...items] : items));
            setPage(targetPage);
            setHasMore(nextPageExists);
            hasLoadedRef.current = true;
        } catch (error) {
            logger.error('Failed to fetch notifications:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [isAuthenticated, isUnreadMode]);

    useEffect(() => {
        if (!isAuthenticated) return;
        fetchNotifications(1, false);
        fetchUnreadCount();
    }, [isAuthenticated, filter, fetchNotifications, fetchUnreadCount]);

    const handleWsMessage = useCallback((data) => {
        if (data.type === 'unread_count') {
            setUnreadCount(data.count ?? 0);
            return;
        }

        if (data.type === 'notification' && data.notification) {
            if (data.unread_count != null) {
                setUnreadCount(data.unread_count);
            } else {
                setUnreadCount((prev) => prev + 1);
            }

            if (filter === 'all' || filter === 'unread') {
                setNotifications((prev) => {
                    const exists = prev.some((item) => item.id === data.notification.id);
                    if (exists) return prev;
                    return [data.notification, ...prev];
                });
            }
            return;
        }

        if (data.type === 'notification_read' && data.notification_id) {
            if (data.unread_count != null) {
                setUnreadCount(data.unread_count);
            }

            setNotifications((prev) => {
                if (filter === 'unread') {
                    return prev.filter((item) => item.id !== data.notification_id);
                }
                return prev.map((item) => {
                    if (item.id !== data.notification_id) return item;
                    return { ...item, is_read: true };
                });
            });
        }
    }, [filter]);

    useWebSocket(
        user ? '/ws/notifications/' : null,
        { onMessage: handleWsMessage },
        { autoConnect: !!user }
    );

    const handleNotificationOpen = useCallback(async (notification) => {
        const target = getNotificationTarget(notification);

        if (!notification.is_read) {
            try {
                await notificationApi.markAsRead(notification.id);
                setNotifications((prev) => prev.map((item) => (
                    item.id === notification.id ? { ...item, is_read: true } : item
                )));
                setUnreadCount((prev) => Math.max(0, prev - 1));
            } catch (error) {
                logger.error('Failed to mark notification as read:', error);
            }
        }

        if (target) {
            navigate(target);
        }
    }, [navigate]);

    const handleMarkRead = async (notificationId) => {
        setActionId(`read-${notificationId}`);
        try {
            await notificationApi.markAsRead(notificationId);
            setNotifications((prev) => {
                if (isUnreadMode) {
                    return prev.filter((item) => item.id !== notificationId);
                }
                return prev.map((item) => (
                    item.id === notificationId ? { ...item, is_read: true } : item
                ));
            });
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (error) {
            logger.error('Failed to mark notification as read:', error);
        } finally {
            setActionId(null);
        }
    };

    const handleDelete = async (notification) => {
        setActionId(`delete-${notification.id}`);
        try {
            await notificationApi.delete(notification.id);
            setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
            if (!notification.is_read) {
                setUnreadCount((prev) => Math.max(0, prev - 1));
            }
        } catch (error) {
            logger.error('Failed to delete notification:', error);
        } finally {
            setActionId(null);
        }
    };

    const handleMarkAllRead = async () => {
        setMarkingAll(true);
        try {
            await notificationApi.markAllAsRead();
            if (isUnreadMode) {
                setNotifications([]);
            } else {
                setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
            }
            setUnreadCount(0);
        } catch (error) {
            logger.error('Failed to mark all notifications as read:', error);
        } finally {
            setMarkingAll(false);
        }
    };

    const visibleEmptyState = useMemo(() => {
        if (!hasLoadedRef.current && loading) return false;
        return notifications.length === 0;
    }, [loading, notifications.length]);

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
                    <p className="text-gray-400 mt-2 mb-6">Sign in to see alerts and updates for your anime activity.</p>
                    <Link to="/login" className="inline-flex items-center gap-2 btn-primary">
                        <LogIn className="w-4 h-4" />
                        Sign in
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
            <SEO page="notifications" noIndex />

            <section className="rounded-2xl border border-gray-800 bg-dark-100/70 backdrop-blur-xl overflow-hidden">
                <header className="border-b border-gray-800 p-4 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-white">Notifications</h1>
                            <p className="text-sm text-gray-400 mt-1">{unreadCount} unread</p>
                        </div>
                        <Link
                            to="/settings"
                            className="text-xs sm:text-sm text-accent hover:text-accent/80 transition-colors"
                        >
                            Notification settings
                        </Link>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                        <div className="inline-flex rounded-xl border border-gray-700 bg-dark-50 p-1">
                            {FILTERS.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => setFilter(item.value)}
                                    className={`px-3 py-1.5 text-xs sm:text-sm rounded-lg transition-colors ${filter === item.value
                                        ? 'bg-accent text-white'
                                        : 'text-gray-300 hover:text-white'
                                        }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>

                        <button
                            type="button"
                            disabled={markingAll || unreadCount === 0}
                            onClick={handleMarkAllRead}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 text-xs sm:text-sm text-gray-200 hover:text-white hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {markingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                            Mark all read
                        </button>
                    </div>
                </header>

                <div className="divide-y divide-gray-800">
                    {loading ? (
                        <div className="p-8 text-center text-gray-400">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin mb-3" />
                            Loading notifications...
                        </div>
                    ) : visibleEmptyState ? (
                        <div className="p-8 text-center text-gray-400">
                            <Bell className="w-9 h-9 mx-auto mb-3 text-gray-600" />
                            <p className="text-sm text-gray-300">No notifications found</p>
                            <p className="text-xs mt-1 text-gray-500">You are all caught up.</p>
                        </div>
                    ) : (
                        notifications.map((notification) => {
                            const target = getNotificationTarget(notification);
                            const isDeleting = actionId === `delete-${notification.id}`;
                            const isReading = actionId === `read-${notification.id}`;

                            return (
                                <article
                                    key={notification.id}
                                    className={`group px-4 sm:px-6 py-4 transition-colors ${notification.is_read ? 'bg-transparent' : 'bg-accent/5'
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`w-2 h-2 mt-2 rounded-full flex-shrink-0 ${notification.is_read ? 'bg-gray-600' : 'bg-accent'}`} />
                                        <button
                                            type="button"
                                            onClick={() => handleNotificationOpen(notification)}
                                            className="flex-1 text-left min-w-0"
                                        >
                                            <h2 className="text-sm sm:text-base font-semibold text-white line-clamp-1">{notification.title}</h2>
                                            <p className="text-xs sm:text-sm text-gray-300 mt-1 line-clamp-2">{notification.message}</p>
                                            <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                                                <span>{formatNotificationTime(notification.created_at)}</span>
                                                {target && (
                                                    <span className="inline-flex items-center gap-1 text-accent/90">
                                                        Open
                                                        <ChevronRight className="w-3 h-3" />
                                                    </span>
                                                )}
                                            </div>
                                        </button>

                                        <div className="flex items-center gap-1.5">
                                            {!notification.is_read && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleMarkRead(notification.id)}
                                                    disabled={isReading || isDeleting}
                                                    className="inline-flex items-center justify-center p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-50"
                                                    aria-label="Mark as read"
                                                    title="Mark as read"
                                                >
                                                    {isReading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(notification)}
                                                disabled={isReading || isDeleting}
                                                className="inline-flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                                                aria-label="Delete notification"
                                                title="Delete"
                                            >
                                                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                </article>
                            );
                        })
                    )}
                </div>

                {hasMore && !loading && (
                    <div className="p-4 sm:p-5 border-t border-gray-800">
                        <button
                            type="button"
                            onClick={() => fetchNotifications(page + 1, true)}
                            disabled={loadingMore}
                            className="w-full rounded-xl border border-gray-700 px-4 py-2.5 text-sm text-gray-200 hover:text-white hover:border-gray-600 disabled:opacity-50"
                        >
                            {loadingMore ? (
                                <span className="inline-flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading more...
                                </span>
                            ) : (
                                'Load more'
                            )}
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
