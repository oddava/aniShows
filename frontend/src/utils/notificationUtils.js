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
    'Review Like',
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
    let title = notification.title || '';
    let message = cleanNotificationMessage(notification.message);
    
    // Check if the title is redundant because entity is in the message
    if (title && message && message.toLowerCase().includes(title.toLowerCase())) {
        title = '';
    } else if (title && title.includes(':')) {
        const parts = title.split(':');
        // Example: "New Badge: Top Reviewer" -> parts[1] is "Top Reviewer"
        if (parts.length === 2 && message.toLowerCase().includes(parts[1].trim().toLowerCase())) {
            title = '';
        }
    }
    
    let combined = title && message && !GENERIC_TITLES.has(title) ? `${title} ${message}`.trim() : (message || title);
    
    // Strip single or double quotes around entities for cleaner display 
    // e.g. "awarded the 'Top Reviewer' badge" -> "awarded the Top Reviewer badge"
    combined = combined.replace(/(^|\s)["']([^"']+)["'](?=\s|$|[.,!?])/g, '$1$2');
    
    return combined;
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
    
    // Get raw message to extract quoted phrases before quotes are stripped in displayText
    const rawMessage = notification?.message || '';
    const quotedPhrases = Array.from(
        rawMessage.matchAll(/(?:^|\s)["']([^"']+)["'](?=\s|$|[.,!?])/g)
    ).map((match) => match[1]);

    const displayText = getNotificationDisplayText(notification);

    const candidateFields = [
        data.anime_title,
        data.badge_name,
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
 * Returns username chunk metadata for notifications where an actor user exists.
 * @param {Object} notification
 * @returns {Object} { username, startIndex, displayText }
 */
export const getActorUsernameData = (notification) => {
    const data = notification?.data || {};
    const displayText = getNotificationDisplayText(notification);
    const usernameCandidate = [
        data.follower_username,
        data.replier_username,
        data.mentioner_username,
        data.liker_username,
        data.actor_username,
    ].find((value) => typeof value === 'string' && value.trim());

    if (!usernameCandidate) {
        return { username: null, startIndex: -1, displayText };
    }

    const normalized = usernameCandidate.trim();
    const startIndex = findTextIndex(displayText, normalized);
    if (startIndex < 0) {
        return { username: normalized, startIndex: -1, displayText };
    }

    return {
        username: displayText.slice(startIndex, startIndex + normalized.length),
        startIndex,
        displayText,
    };
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
