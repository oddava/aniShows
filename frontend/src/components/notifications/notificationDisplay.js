import { getImageUrl } from '../../utils/imageUtils';

// Display helpers for a notification row: relative time, thumbnail and the
// follower avatar fallback.

export const formatRelativeTime = (value) => {
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


export const getAnimeSlug = (notification) => notification?.data?.anime_slug || null;

export const getNotificationThumbnail = (notification, coverBySlug, followerAvatarByUsername) => {
    const data = notification?.data || {};
    const animeSlug = getAnimeSlug(notification);
    const followerUsername = data.follower_username;
    const fetchedFollowerAvatar = followerUsername ? followerAvatarByUsername[followerUsername] : null;
    const rawUrl =
        data.anime_cover_image_small ||
        data.anime_cover_image_medium ||
        data.anime_cover_image ||
        data.anime_cover ||
        data.cover_image ||
        (animeSlug ? coverBySlug[animeSlug] : null) ||
        data.follower_avatar_url ||
        data.follower_avatar ||
        data.avatar ||
        data.user_avatar ||
        fetchedFollowerAvatar ||
        null;

    return rawUrl ? getImageUrl(rawUrl, data.anime_title || data.follower_username || 'Notification') : null;
};

export const hasEmbeddedImage = (notification) => {
    const data = notification?.data || {};
    return Boolean(
        data.anime_cover_image_small ||
        data.anime_cover_image_medium ||
        data.anime_cover_image ||
        data.anime_cover ||
        data.cover_image ||
        data.follower_avatar
    );
};

export const isFollowerNotification = (notification) => notification?.notification_type === 'new_follower';

export const getFollowerDisplayName = (notification) => notification?.data?.follower_username || 'User';

export const getFollowerInitials = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return 'U';
    return clean.slice(0, 2).toUpperCase();
};
