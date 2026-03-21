/**
 * Utilities for formatting and processing notifications.
 */

/**
 * Strips common suffixes from notification messages that were meant for mobile/push.
 * @param {string} message 
 * @returns {string}
 */
export const cleanNotificationMessage = (message) => {
    if (!message) return '';
    return message
        .replace(/\s*tap to[^.]*\.?\s*$/i, '')
        .trim();
};

const GENERIC_TITLES = new Set([
    'Badge Awarded', 
    'New Episode', 
    'Review Reply', 
    'New Follower', 
    'Forum Reply', 
    'Mentioned', 
    'New Like', 
    'System'
]);

/**
 * Combines title and message into a single display string.
 * @param {Object} notification 
 * @returns {string}
 */
export const getNotificationDisplayText = (notification) => {
    const title = notification.title || '';
    const message = cleanNotificationMessage(notification.message);
    
    if (!title) return message;
    if (!message) return title;

    // If the title is just a category or generic name, skip it in the display
    // unless the message is missing. This follows the user's request for conciseness.
    if (GENERIC_TITLES.has(title)) return message;
    
    // Check if the title is already part of the message to avoid redundancy
    if (message.toLowerCase().includes(title.toLowerCase())) return message;
    
    return `${title} ${message}`.trim();
};

/**
 * Escapes regex special characters.
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds the first index of a string in another, case-insensitive.
 */
const findTextIndex = (source, needle) => {
    if (!source || !needle) return -1;
    const match = source.match(new RegExp(escapeRegex(needle), 'i'));
    return match ? match.index : -1;
};

/**
 * Infers an entity name from a title of format "Category: Entity".
 */
export const inferEntityFromTitle = (title) => {
    if (!title || !title.includes(':')) return null;
    const match = title.match(/:\s*([^.,!]+?)(?:\s+Episode\s+\d+|\s+airs\b|$)/i);
    return match?.[1]?.trim() || null;
};

/**
 * Identifies which part of the display text should be highlighted and what it links to.
 * @param {Object} notification 
 * @returns {Object} { displayText, entity, startIndex }
 */
export const getHighlightEntityData = (notification) => {
    const data = notification?.data || {};
    const displayText = getNotificationDisplayText(notification);
    
    // Match quoted phrases like 'Staff' or 'One Piece' (though quotes are being removed)
    const quotedPhrases = Array.from(
        displayText.matchAll(/(?:^|\s)['"]([^'"]+)['"](?=\s|$|[.,!?])/g)
    ).map((match) => match[1]);

    const candidateFields = [
        data.anime_title,
        data.badge_name,
        data.follower_username,
        data.replier_username,
        data.mentioner_username,
        data.liker_username,
        data.thread_title,
        ...quotedPhrases,
        inferEntityFromTitle(notification?.title || ''),
    ];

    const uniqueCandidates = Array.from(
        new Set(
            candidateFields
                .filter((value) => typeof value === 'string')
                .map((value) => value.trim())
                .filter(Boolean)
        )
    ).sort((a, b) => b.length - a.length);

    for (const candidate of uniqueCandidates) {
        const startIndex = findTextIndex(displayText, candidate);
        if (startIndex >= 0) {
            return { 
                displayText, 
                entity: displayText.slice(startIndex, startIndex + candidate.length), 
                startIndex 
            };
        }
    }

    return { displayText, entity: uniqueCandidates[0] || null, startIndex: -1 };
};

/**
 * Returns the target URL for a notification.
 */
export const getNotificationTarget = (notification) => {
    const data = notification?.data || {};

    if (data.anime_slug) return `/anime/${data.anime_slug}`;
    if (notification.notification_type === 'new_follower' && data.follower_username) {
        return `/u/${data.follower_username}`;
    }
    if (
        (notification.notification_type === 'forum_reply' ||
            notification.notification_type === 'forum_mention' ||
            notification.notification_type === 'forum_like' ||
            notification.notification_type === 'forum_thread_reply') &&
        data.thread_id
    ) {
        return `/forums/thread/${data.thread_id}`;
    }
    if (notification.notification_type === 'badge_awarded') return '/profile';

    return null;
};
