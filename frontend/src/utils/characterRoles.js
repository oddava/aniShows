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
