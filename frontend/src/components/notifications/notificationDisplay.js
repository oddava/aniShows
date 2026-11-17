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


const coverFrom = (data) => (
    data.anime_cover_image_small
    || data.anime_cover_image_medium
    || data.anime_cover_image
    || data.anime_cover
    || data.cover_image
    || null
);

const avatarFrom = (notification) => {
    const data = notification?.data || {};
    return notification?.actor?.avatar
        || data.follower_avatar_url
        || data.follower_avatar
        || data.avatar
        || data.user_avatar
        || null;
};

/** The person behind a notification (follower, replier, liker), if any. */
export const getActorName = (notification) => {
    const data = notification?.data || {};
    return notification?.actor?.username
        || data.follower_username
        || data.replier_username
        || data.mentioner_username
        || data.liker_username
        || data.actor_username
        || null;
};

/**
 * What to show beside a row, all from the API payload (the page makes no
 * lookups of its own): the anime cover when the notification carries one,
 * else the actor's avatar (`kind: 'avatar'`, initials when it has none).
 * Returns `{kind: 'cover' | 'avatar' | null, url, name}`.
 */
export const getNotificationVisual = (notification) => {
    const data = notification?.data || {};
    const cover = coverFrom(data);
    if (cover) {
        return { kind: 'cover', url: getImageUrl(cover, data.anime_title || 'Notification'), name: data.anime_title || null };
    }

    const actorName = getActorName(notification);
    const avatar = avatarFrom(notification);
    if (actorName || avatar || isFollowerNotification(notification)) {
        const name = actorName || 'User';
        return { kind: 'avatar', url: avatar ? getImageUrl(avatar, name) : null, name };
    }

    return { kind: null, url: null, name: null };
};

export const isFollowerNotification = (notification) => notification?.notification_type === 'new_follower';

export const getFollowerDisplayName = (notification) => notification?.data?.follower_username || 'User';

export const getFollowerInitials = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return 'U';
    return clean.slice(0, 2).toUpperCase();
};
