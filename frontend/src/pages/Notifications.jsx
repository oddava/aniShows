import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Loader2, LogIn } from 'lucide-react';

import { animeApi, notificationApi } from '../api/client';
import SEO from '../components/SEO';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import logger from '../utils/logger';

const NOTIFICATION_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'new_episode', label: 'Episodes' },
    { value: 'review_reply', label: 'Review Replies' },
    { value: 'new_follower', label: 'Followers' },
    { value: 'forum', label: 'Forum' },
    { value: 'badge_awarded', label: 'Badges' },
    { value: 'system', label: 'System' },
];

const FORUM_FILTER_TYPES = new Set(['forum_reply', 'forum_mention', 'forum_like']);

const formatRelativeTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'just now';

    const diffMs = date.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const month = 30 * day;
    const year = 365 * day;

    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    if (absMs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
    if (absMs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
    if (absMs < month) return rtf.format(Math.round(diffMs / day), 'day');
    if (absMs < year) return rtf.format(Math.round(diffMs / month), 'month');
    return rtf.format(Math.round(diffMs / year), 'year');
};

const cleanNotificationMessage = (message) => {
    if (!message) return '';
    return message
        .replace(/\s*tap to[^.]*\.?\s*$/i, '')
        .trim();
};

const getDisplayText = (notification) => {
    const message = cleanNotificationMessage(notification.message);
    return `${notification.title || ''}${message ? ` ${message}` : ''}`.trim();
};

const inferEntityFromTitle = (title) => {
    if (!title || !title.includes(':')) return null;
    const match = title.match(/:\s*([^.,!]+?)(?:\s+Episode\s+\d+|\s+airs\b|$)/i);
    return match?.[1]?.trim() || null;
};

const getHighlightEntity = (notification) => {
    const data = notification?.data || {};
    const candidateFields = [
        data.anime_title,
        data.badge_name,
        data.follower_username,
        data.replier_username,
        data.mentioner_username,
        data.liker_username,
        data.thread_title,
    ];

    const fromData = candidateFields.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (fromData) return fromData;

    return inferEntityFromTitle(notification?.title || '');
};

const getNotificationTarget = (notification) => {
    const data = notification?.data || {};

    if (data.anime_slug) return `/anime/${data.anime_slug}`;
    if (notification.notification_type === 'new_follower' && data.follower_username) {
        return `/u/${data.follower_username}`;
    }
    if (
        (notification.notification_type === 'forum_reply' ||
            notification.notification_type === 'forum_mention' ||
            notification.notification_type === 'forum_like') &&
        data.thread_id
    ) {
        return `/forums/thread/${data.thread_id}`;
    }
    if (notification.notification_type === 'badge_awarded') return '/profile';

    return null;
};

const getAnimeSlug = (notification) => notification?.data?.anime_slug || null;

const getNotificationThumbnail = (notification, coverBySlug) => {
    const data = notification?.data || {};
    const animeSlug = getAnimeSlug(notification);

    return (
        (animeSlug ? coverBySlug[animeSlug] : null) ||
        data.anime_cover_image_small ||
        data.anime_cover_image ||
        data.anime_cover ||
        data.cover_image ||
        data.follower_avatar ||
        null
    );
};

const hasEmbeddedImage = (notification) => {
    const data = notification?.data || {};
    return Boolean(
        data.anime_cover_image_small ||
        data.anime_cover_image ||
        data.anime_cover ||
        data.cover_image ||
        data.follower_avatar
    );
};

export default function Notifications() {
    const { user, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(false);
    const [coverBySlug, setCoverBySlug] = useState({});
    const [activeFilter, setActiveFilter] = useState('all');

    const fetchNotifications = useCallback(async () => {
        if (!isAuthenticated) return;

        setLoading(true);
        try {
            const response = await notificationApi.getAll({ page_size: 60 });
            setNotifications(response.data?.results || []);
        } catch (error) {
            logger.error('Failed to fetch notifications:', error);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    useEffect(() => {
        const animeSlugs = Array.from(
            new Set(
                notifications
                    .slice(0, 24)
                    .map((item) => (hasEmbeddedImage(item) ? null : getAnimeSlug(item)))
                    .filter(Boolean)
            )
        );

        const slugsToFetch = animeSlugs.filter((slug) => !(slug in coverBySlug));
        if (slugsToFetch.length === 0) return;

        let cancelled = false;

        const fetchCovers = async () => {
            const entries = [];
            // Keep request fan-out bounded to avoid network spikes on large notification lists.
            const maxToFetch = slugsToFetch.slice(0, 12);
            for (const slug of maxToFetch) {
                try {
                    const response = await animeApi.getBySlug(slug);
                    const anime = response.data || {};
                    entries.push([slug, anime.cover_image_small || anime.cover_image_medium || anime.cover_image || null]);
                } catch {
                    entries.push([slug, null]);
                }
            }

            if (cancelled) return;

            setCoverBySlug((prev) => {
                const next = { ...prev };
                entries.forEach(([slug, url]) => {
                    next[slug] = url;
                });
                return next;
            });
        };

        fetchCovers();
        return () => {
            cancelled = true;
        };
    }, [notifications, coverBySlug]);

    useEffect(() => {
        if (!isAuthenticated) return;

        const markAllReadOnOpen = async () => {
            try {
                await notificationApi.markAllAsRead();
                window.dispatchEvent(
                    new CustomEvent('notifications:unread-count', { detail: { count: 0 } })
                );
            } catch (error) {
                logger.error('Failed to mark notifications as read on open:', error);
            }
        };

        markAllReadOnOpen();
    }, [isAuthenticated]);

    const handleWsMessage = useCallback((data) => {
        if (data.type === 'notification' && data.notification) {
            setNotifications((prev) => {
                const exists = prev.some((item) => item.id === data.notification.id);
                if (exists) return prev;
                return [data.notification, ...prev];
            });
            return;
        }

        if (data.type === 'notification_read' && data.notification_id) {
            setNotifications((prev) => prev.map((item) => (
                item.id === data.notification_id ? { ...item, is_read: true } : item
            )));
        }
    }, []);

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
            } catch (error) {
                logger.error('Failed to mark notification as read:', error);
            }
        }

        if (target) navigate(target);
    }, [navigate]);

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

            {loading ? (
                <div className="min-h-[40vh] flex items-center justify-center text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                </div>
            ) : (
                <>
                    <div className="mb-9 sm:mb-10 overflow-x-auto scrollbar-hide">
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

                    {filteredNotifications.length === 0 ? (
                <div className="min-h-[40vh] flex flex-col items-center justify-center text-gray-400">
                    <Bell className="w-10 h-10 mb-3 text-gray-600" />
                    <p className="text-sm text-gray-300">No notifications for this filter</p>
                </div>
            ) : (
                <div className="mt-4 sm:mt-5 max-w-4xl mx-auto space-y-2.5 sm:space-y-3.5">
                    {filteredNotifications.map((notification) => {
                        const thumbnail = getNotificationThumbnail(notification, coverBySlug);
                        const displayText = getDisplayText(notification);
                        const highlightEntity = getHighlightEntity(notification);
                        const highlightStart = highlightEntity ? displayText.indexOf(highlightEntity) : -1;
                        const hasHighlightedChunk = highlightStart >= 0;
                        const target = getNotificationTarget(notification);

                        const handleEntityClick = async () => {
                            await handleNotificationOpen(notification);
                        };

                        return (
                            <div key={notification.id} className="w-full">
                                <div className="flex overflow-hidden rounded-md bg-dark-100/80">
                                    {thumbnail && (
                                        <img
                                            src={thumbnail}
                                            alt=""
                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            className="w-14 h-20 sm:w-16 sm:h-24 object-cover bg-dark-50 flex-shrink-0"
                                            loading="lazy"
                                        />
                                    )}

                                    <div className="min-w-0 flex-1 px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-2.5">
                                        <p className="min-w-0 text-sm sm:text-base leading-snug text-gray-300 line-clamp-2 pr-1 sm:pr-2">
                                            {hasHighlightedChunk ? (
                                                <>
                                                    <span>{displayText.slice(0, highlightStart)}</span>
                                                    {target ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleEntityClick}
                                                            className="text-accent hover:text-accent/80 transition-colors"
                                                        >
                                                            {highlightEntity}
                                                        </button>
                                                    ) : (
                                                        <span className="text-accent">{highlightEntity}</span>
                                                    )}
                                                    <span>{displayText.slice(highlightStart + highlightEntity.length)}</span>
                                                </>
                                            ) : (
                                                <span>{displayText}</span>
                                            )}
                                        </p>
                                        <span className="text-[11px] sm:text-[13px] text-gray-500 whitespace-nowrap self-end sm:self-auto sm:mt-0.5">
                                            {formatRelativeTime(notification.created_at)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
                </>
            )}
        </div>
    );
}
