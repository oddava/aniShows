// The profile status (UserProfile.status_emoji / status_text). Limits match
// apps/users/services/profile_expression.py: the server checks them too.

/** Quick picks for the status emoji (Settings and the profile's pill editor). */
export const STATUS_EMOJIS = ['📺', '🍿', '🔥', '😭', '💤', '🎧', '📚', '🎮', '✨', '🌸', '🍜', '💀'];

export const STATUS_TEXT_MAX = 80;

/** One line, whitespace folded, as the server stores it. */
export const normalizeStatusText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** An error message for a status draft, or null when it can be saved. */
export function validateStatusText(value) {
    const text = normalizeStatusText(value);
    if (text.length > STATUS_TEXT_MAX) return `Keep it to ${STATUS_TEXT_MAX} characters or fewer.`;
    return null;
}
