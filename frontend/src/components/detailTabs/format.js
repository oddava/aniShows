// Small display helpers shared by the anime detail page.

/**
 * Data that arrives shouting ("MAIN", "FALL 2026", "SIDE_STORY") in sentence
 * case ("Main", "Fall 2026", "Side story"). Mixed-case strings pass through.
 */
export function capsToSentence(value) {
    if (value == null) return '';
    const text = String(value).replace(/_/g, ' ').trim();
    if (!text || text !== text.toUpperCase()) return text;
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "Episode 3" style titles say nothing the number doesn't. */
export function meaningfulEpisodeTitle(episode) {
    const title = String(episode?.title || '').trim();
    if (!title) return '';
    if (/^(episode|ep\.?)\s*\d+$/i.test(title)) return '';
    return title;
}

/**
 * Catalog names arrive "Family, Given" ("Tachibana, Tatsumaru",
 * "Monkey D., Luffy"). Shown without the comma, in the same order.
 */
export function displayPersonName(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
    return parts.length === 2 ? `${parts[0]} ${parts[1]}` : text;
}

const ROLE_ORDER = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };
const roleRank = (role) => ROLE_ORDER[String(role?.role || '').toUpperCase()] ?? 3;

/**
 * The cast in reading order: main roles first, then supporting, then
 * background, never alphabetical by the client. Inside a role the API's own
 * order is kept (stable sort), so "Load more" adds rows after those shown.
 * With `voicedFirst`, voiced characters lead within their role: a fair hint
 * of who matters, used where only the first few are shown.
 */
export function orderCast(roles, { voicedFirst = false } = {}) {
    if (!Array.isArray(roles)) return [];
    return roles
        .map((role, index) => ({ role, index }))
        .sort((a, b) => (
            roleRank(a.role) - roleRank(b.role)
            || (voicedFirst ? Number(!a.role?.voice_actor) - Number(!b.role?.voice_actor) : 0)
            || a.index - b.index
        ))
        .map(({ role }) => role);
}
