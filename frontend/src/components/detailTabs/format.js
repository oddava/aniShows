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

/**
 * Staff roles arrive in Title Case ("Series Composition", "ADR Director").
 * Shown in sentence case ("Series composition", "ADR director"): only plain
 * capitalised words after the first are lowered, so acronyms stay intact.
 */
export function roleToSentence(value) {
    const text = capsToSentence(value);
    return text.replace(/(\s)([A-Z])([a-z]+)\b/g, (_, space, first, rest) => `${space}${first.toLowerCase()}${rest}`);
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

// The credits that say who made a show, best first (role strings as the
// catalog sends them, compared case-insensitively).
const KEY_STAFF_ROLES = ['director', 'series composition', 'character design', 'music', 'original creator'];
// Per-episode credits: real, but say little about the show as a whole.
const MINOR_STAFF_ROLE = /episode director|storyboard|key animation|in-?between|^assistant /;
// Business credits (producers, planning, publicity): the least useful.
const PRODUCER_STAFF_ROLE = /producer|production (?:manager|coordinat)|publicity|planning|licens/;

const staffTier = (role) => {
    const value = String(role || '').trim().toLowerCase();
    const key = KEY_STAFF_ROLES.indexOf(value);
    if (key >= 0) return { group: 0, rank: key };
    if (PRODUCER_STAFF_ROLE.test(value)) return { group: 3, rank: 0 };
    if (MINOR_STAFF_ROLE.test(value)) return { group: 2, rank: 0 };
    return { group: 1, rank: 0 };
};

/**
 * The few staff credits worth a glance on the overview: director, series
 * composition, character design and music first (one of each before a second
 * of any), then other crew, then per-episode credits. Producers only when
 * nothing else is credited. One credit per person (their best role), and
 * people with a photo lead within a role. `hasPortrait` decides that last.
 */
export function pickKeyStaff(staff, { limit = 4, hasPortrait = () => true } = {}) {
    if (!Array.isArray(staff)) return [];
    const byRole = (a, b) => a.group - b.group || a.rank - b.rank || a.photo - b.photo || a.index - b.index;
    const candidates = staff
        .filter((credit) => credit?.staff?.name)
        .map((credit, index) => ({ credit, index, ...staffTier(credit.role), photo: hasPortrait(credit.staff) ? 0 : 1 }))
        .sort(byRole);

    const hasBetterThanProducers = candidates.some((entry) => entry.group < 3);
    const seenPerson = new Set();
    const seenRole = new Map();
    return candidates
        .filter((entry) => !(hasBetterThanProducers && entry.group === 3))
        // Best role per person: candidates are in role order, so the first wins.
        .filter((entry) => {
            const person = entry.credit.staff.id ?? entry.credit.staff.name;
            if (seenPerson.has(person)) return false;
            seenPerson.add(person);
            return true;
        })
        .map((entry) => {
            const role = String(entry.credit.role || '').trim().toLowerCase();
            const occurrence = seenRole.get(role) || 0;
            seenRole.set(role, occurrence + 1);
            return { ...entry, occurrence };
        })
        // Spread the key roles: each one's first credit before any second.
        .sort((a, b) => a.group - b.group || (a.group === 0 ? a.occurrence - b.occurrence : 0) || byRole(a, b))
        .slice(0, limit)
        .map((entry) => entry.credit);
}
