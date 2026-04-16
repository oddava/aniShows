import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Loader2, LogIn } from 'lucide-react';

import { animeApi, authApi, notificationApi } from '../api/client';
import SEO from '../components/SEO';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { applyImageFallback, getImageUrl } from '../utils/imageUtils';
import logger from '../utils/logger';
import { formatDateTimeInUserTimezone } from '../utils/dateUtils';
import { 
    getActorUsernameData,
    getHighlightEntityData,
    getNotificationTarget
} from '../utils/notificationUtils';

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
const PAGE_SIZE = 30;

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

// These functions are now in notificationUtils

const getAnimeSlug = (notification) => notification?.data?.anime_slug || null;

const getNotificationThumbnail = (notification, coverBySlug, followerAvatarByUsername) => {
    const data = notification?.data || {};
    const animeSlug = getAnimeSlug(notification);
    const followerUsername = data.follower_username;
    const fetchedFollowerAvatar = followerUsername ? followerAvatarByUsername[followerUsername] : null;
    const rawUrl =
        (animeSlug ? coverBySlug[animeSlug] : null) ||
        data.anime_cover_image_small ||
        data.anime_cover_image ||
        data.anime_cover ||
        data.cover_image ||
        data.follower_avatar_url ||
        data.follower_avatar ||
        data.avatar ||
        data.user_avatar ||
        fetchedFollowerAvatar ||
        null;

    return rawUrl ? getImageUrl(rawUrl, data.anime_title || data.follower_username || 'Notification') : null;
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

const isFollowerNotification = (notification) => notification?.notification_type === 'new_follower';

const getFollowerDisplayName = (notification) => notification?.data?.follower_username || 'User';

const getFollowerInitials = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return 'U';
    return clean.slice(0, 2).toUpperCase();
};

const parseNextPageNumber = (nextUrl) => {
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

export default function Notifications() {
    const { user, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const [notifications, setNotifications] = useState([]);
    const [loadingInitial, setLoadingInitial] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [markingAllRead, setMarkingAllRead] = useState(false);
    const [coverBySlug, setCoverBySlug] = useState({});
    const [activeFilter, setActiveFilter] = useState('all');
    const [nextPage, setNextPage] = useState(null);
    const [fetchError, setFetchError] = useState('');
    const [actionError, setActionError] = useState('');

    const markNotificationRead = useCallback(async (notification) => {
        if (notification.is_read) return;

        await notificationApi.markAsRead(notification.id);
        setNotifications((prev) => prev.map((item) => (
            item.id === notification.id ? { ...item, is_read: true } : item
        )));
    }, []);
    const [brokenThumbIds, setBrokenThumbIds] = useState(new Set());
    const [followerAvatarByUsername, setFollowerAvatarByUsername] = useState({});

    const fetchNotifications = useCallback(async ({ page = 1, append = false } = {}) => {
        if (!isAuthenticated) return;

        if (append) {
            setLoadingMore(true);
        } else {
            setLoadingInitial(true);
            setFetchError('');
        }
        try {
            const response = await notificationApi.getAll({ page_size: PAGE_SIZE, page });
            const next = parseNextPageNumber(response.data?.next || null);
            const incoming = response.data?.results || [];
            setNextPage(next);

            setNotifications((prev) => {
                if (!append) return incoming;
                const seen = new Set(prev.map((item) => item.id));
                const merged = [...prev];
                incoming.forEach((item) => {
                    if (!seen.has(item.id)) merged.push(item);
                });
                return merged;
            });
        } catch (error) {
            logger.error('Failed to fetch notifications:', error);
            setFetchError('Failed to load notifications. Please try again.');
        } finally {
            setLoadingInitial(false);
            setLoadingMore(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        fetchNotifications({ page: 1, append: false });
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
        const usernamesToFetch = Array.from(
            new Set(
                notifications
                    .filter((item) => item.notification_type === 'new_follower')
                    .map((item) => item?.data?.follower_username)
                    .filter((username) => typeof username === 'string' && username.trim().length > 0)
                    .filter((username) => followerAvatarByUsername[username] === undefined)
            )
        ).slice(0, 8);

        if (usernamesToFetch.length === 0) return;

        let cancelled = false;

        const fetchFollowerAvatars = async () => {
            const entries = await Promise.all(
                usernamesToFetch.map(async (username) => {
                    try {
                        const response = await authApi.getByUsername(username);
                        return [username, response.data?.avatar || null];
                    } catch {
                        return [username, null];
                    }
                })
            );

            if (cancelled) return;

            setFollowerAvatarByUsername((prev) => {
                const next = { ...prev };
                entries.forEach(([username, avatar]) => {
                    next[username] = avatar;
                });
                return next;
            });
        };

        fetchFollowerAvatars();
        return () => {
            cancelled = true;
        };
    }, [notifications, followerAvatarByUsername]);

    const handleWsMessage = useCallback((data) => {
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
        }
    }, []);

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
        setMarkingAllRead(true);
        setActionError('');
        try {
            await notificationApi.markAllAsRead();
            setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
            window.dispatchEvent(
                new CustomEvent('notifications:unread-count', { detail: { count: 0 } })
            );
        } catch (error) {
            logger.error('Failed to mark all notifications as read:', error);
            setActionError('Could not mark all notifications as read.');
        } finally {
            setMarkingAllRead(false);
        }
    }, []);

    const handleLoadMore = useCallback(async () => {
        if (!nextPage || loadingMore) return;
        await fetchNotifications({ page: nextPage, append: true });
    }, [fetchNotifications, loadingMore, nextPage]);

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
                                onClick={() => fetchNotifications({ page: 1, append: false })}
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
                    {filteredNotifications.map((notification) => {
                        const thumbnail = getNotificationThumbnail(notification, coverBySlug, followerAvatarByUsername);
                        const { displayText, entity: highlightEntity, startIndex: highlightStart } = getHighlightEntityData(notification);
                        const { username: actorUsername, startIndex: actorStart } = getActorUsernameData(notification);
                        const hasHighlightedChunk = highlightStart >= 0;
                        const target = getNotificationTarget(notification);
                        const followerNotification = isFollowerNotification(notification);
                        const followerName = getFollowerDisplayName(notification);
                        const brokenFollowerThumb = followerNotification && brokenThumbIds.has(notification.id);
                        const exactTimestamp = formatDateTimeInUserTimezone(notification.created_at, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZoneName: 'short',
                        });
                        const thumbnailAlt = highlightEntity
                            ? `${highlightEntity} notification image`
                            : 'Notification image';
                        const thumbnailFallback = getImageUrl(
                            null,
                            notification?.data?.anime_title || notification?.data?.follower_username || 'Notification'
                        );

                        const handleEntityClick = async () => {
                            await handleNotificationOpen(notification);
                        };

                        const handleActorClick = async () => {
                            if (!actorUsername) return;
                            setActionError('');
                            try {
                                await markNotificationRead(notification);
                            } catch (error) {
                                logger.error('Failed to mark notification as read:', error);
                                setActionError('Could not update read status for this notification.');
                            }
                            navigate(`/u/${actorUsername}`);
                        };

                        return (
                            <div key={notification.id} className="w-full">
                                <div className="flex overflow-hidden rounded-md bg-dark-100/80">
                                    {(thumbnail || followerNotification) && (
                                        <div
                                            className={`flex-shrink-0 ${followerNotification
                                                ? 'w-14 self-stretch sm:self-auto sm:w-16 sm:h-16'
                                                : 'w-14 h-20 sm:w-16 sm:h-24 bg-dark-50 flex items-center justify-center'
                                                }`}
                                        >
                                            {followerNotification ? (
                                                brokenFollowerThumb || !thumbnail ? (
                                                    <div
                                                        className="w-full h-full bg-accent/15 flex items-center justify-center font-semibold text-accent-light"
                                                        aria-label={`${followerName} avatar fallback`}
                                                        title={followerName}
                                                    >
                                                        {getFollowerInitials(followerName)}
                                                    </div>
                                                ) : (
                                                    <img
                                                        src={thumbnail}
                                                        alt={`${followerName} profile picture`}
                                                        onError={() => {
                                                            setBrokenThumbIds((prev) => {
                                                                const next = new Set(prev);
                                                                next.add(notification.id);
                                                                return next;
                                                            });
                                                        }}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                )
                                            ) : (
                                                <img
                                                    src={thumbnail}
                                                    alt={thumbnailAlt}
                                                    onError={(event) => applyImageFallback(event, thumbnailFallback)}
                                                    className="w-14 h-20 sm:w-16 sm:h-24 object-cover"
                                                    loading="lazy"
                                                />
                                            )}
                                        </div>
                                    )}

                                    <div className="min-w-0 flex-1 px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-2.5">
                                        <p className="min-w-0 text-sm sm:text-base leading-snug text-gray-300 line-clamp-2 pr-1 sm:pr-2">
                                            {(() => {
                                                const segments = [];
                                                const actorEnd = actorStart + (actorUsername?.length || 0);
                                                const highlightEnd = hasHighlightedChunk
                                                    ? highlightStart + highlightEntity.length
                                                    : -1;
                                                const hasOverlap = actorStart >= 0 && hasHighlightedChunk && !(
                                                    highlightEnd <= actorStart || actorEnd <= highlightStart
                                                );

                                                if (actorStart >= 0 && actorUsername) {
                                                    segments.push({
                                                        kind: 'actor',
                                                        start: actorStart,
                                                        end: actorEnd,
                                                        text: actorUsername,
                                                    });
                                                }

                                                if (hasHighlightedChunk && !hasOverlap) {
                                                    segments.push({
                                                        kind: 'entity',
                                                        start: highlightStart,
                                                        end: highlightEnd,
                                                        text: highlightEntity,
                                                    });
                                                }

                                                if (segments.length === 0) {
                                                    return (
                                                        <span>
                                                            {displayText}
                                                            {target && (
                                                                <>
                                                                    {' '}
                                                                    <button
                                                                        type="button"
                                                                        onClick={handleEntityClick}
                                                                        className="text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm cursor-pointer"
                                                                    >
                                                                        Open
                                                                    </button>
                                                                </>
                                                            )}
                                                        </span>
                                                    );
                                                }

                                                const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
                                                let cursor = 0;
                                                const parts = [];

                                                sortedSegments.forEach((segment, index) => {
                                                    if (segment.start > cursor) {
                                                        parts.push(
                                                            <span key={`text-${notification.id}-${index}`}>
                                                                {displayText.slice(cursor, segment.start)}
                                                            </span>
                                                        );
                                                    }

                                                    if (segment.kind === 'actor') {
                                                        parts.push(
                                                            <button
                                                                key={`actor-${notification.id}-${index}`}
                                                                type="button"
                                                                onClick={handleActorClick}
                                                                className="text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm cursor-pointer"
                                                            >
                                                                {segment.text}
                                                            </button>
                                                        );
                                                    } else if (target) {
                                                        parts.push(
                                                            <button
                                                                key={`entity-${notification.id}-${index}`}
                                                                type="button"
                                                                onClick={handleEntityClick}
                                                                className="text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm cursor-pointer"
                                                            >
                                                                {segment.text}
                                                            </button>
                                                        );
                                                    } else {
                                                        parts.push(
                                                            <span
                                                                key={`entity-${notification.id}-${index}`}
                                                                className="text-accent font-semibold"
                                                            >
                                                                {segment.text}
                                                            </span>
                                                        );
                                                    }

                                                    cursor = segment.end;
                                                });

                                                if (cursor < displayText.length) {
                                                    parts.push(
                                                        <span key={`tail-${notification.id}`}>
                                                            {displayText.slice(cursor)}
                                                        </span>
                                                    );
                                                }

                                                return <>{parts}</>;
                                            })()}
                                        </p>
                                        <span
                                            className="text-[11px] sm:text-[13px] text-gray-500 whitespace-nowrap self-end sm:self-auto sm:mt-0.5"
                                            title={exactTimestamp}
                                        >
                                            {formatRelativeTime(notification.created_at)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
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
