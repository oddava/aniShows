const ROLE_PRIORITY = {
    MAIN: 3,
    SUPPORTING: 2,
    BACKGROUND: 1,
};

const normalizeDisplayName = (value) => (
    String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
);

const normalizeCommaOrderedName = (value) => {
    const normalized = normalizeDisplayName(value);
    const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);

    if (parts.length === 2) {
        return `${parts[1]} ${parts[0]}`;
    }

    return normalized;
};

export const normalizeCharacterRoleName = (value) => (
    normalizeCommaOrderedName(value).toLowerCase()
);

const getRolePriority = (role) => ROLE_PRIORITY[String(role || '').toUpperCase()] || 0;

const hasCommaOrderedName = (value) => (
    normalizeDisplayName(value).split(',').filter(Boolean).length === 2
);

const getCharacterRoleKey = (role, { includeVoiceActor }) => {
    const characterName = normalizeCharacterRoleName(role?.character?.name);
    if (!characterName) return null;

    if (!includeVoiceActor) return characterName;

    const voiceActorName = normalizeCharacterRoleName(role?.voice_actor?.name) || 'none';
    return `${characterName}:${voiceActorName}`;
};

const getCharacterRoleCompleteness = (role) => (
    (getRolePriority(role?.role) * 10) +
    (role?.voice_actor ? 4 : 0) +
    (role?.character?.image ? 2 : 0) +
    (role?.voice_actor?.image ? 1 : 0) +
    (hasCommaOrderedName(role?.character?.name) ? 0 : 2) +
    (!role?.voice_actor || !hasCommaOrderedName(role?.voice_actor?.name) ? 1 : 0)
);

export function getUniqueCharacterRoles(characters, { includeVoiceActor = true } = {}) {
    if (!Array.isArray(characters)) return [];

    const uniqueRoles = new Map();
    for (const role of characters) {
        const key = getCharacterRoleKey(role, { includeVoiceActor });
        if (!key) continue;

        const current = uniqueRoles.get(key);
        if (!current || getCharacterRoleCompleteness(role) > getCharacterRoleCompleteness(current)) {
            uniqueRoles.set(key, role);
        }
    }

    return Array.from(uniqueRoles.values());
}

export function getUniqueCharacterRoleCount(characters) {
    return getUniqueCharacterRoles(characters).length;
}

/**
 * Character / staff page roles grouped by anime, so one anime appears once.
 * Keeps the backend's order (first appearance). Each group has the anime,
 * its distinct role labels and the distinct people from `personField`
 * (e.g. "voice_actor" on a character page, "character" on a staff page).
 */
export function groupRolesByAnime(roles, { personField } = {}) {
    if (!Array.isArray(roles)) return [];

    const groups = new Map();
    roles.forEach((entry, index) => {
        const anime = entry?.anime;
        const key = String(anime?.id ?? anime?.slug ?? `entry-${entry?.id ?? index}`);
        let group = groups.get(key);
        if (!group) {
            group = { key, anime, roles: [], people: [] };
            groups.set(key, group);
        }

        const role = String(entry?.role || '').trim();
        if (role && !group.roles.includes(role)) group.roles.push(role);

        const person = personField ? entry?.[personField] : null;
        const personKey = person?.id ?? person?.name;
        if (personKey != null && !group.people.some((p) => (p.id ?? p.name) === personKey)) {
            group.people.push(person);
        }
    });

    return Array.from(groups.values());
}

/**
 * The URL when it is an absolute http(s) link, else null. Descriptions come
 * from AniList markup; any other scheme (data:, javascript:, relative paths)
 * is shown as plain text instead of a link.
 */
export function toSafeHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

/**
 * A description in AniList markup as one line of plain text for meta tags:
 * spoilers dropped, tags removed, links reduced to their text, emphasis
 * markers removed, cut to `maxLength` characters.
 */
export function markupToPlainText(text, maxLength = 160) {
    return String(text || '')
        .replace(/~!.*?!~/gs, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(\*|_)(.+?)\1/g, '$2')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
        .trim();
}
