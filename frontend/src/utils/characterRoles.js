const ROLE_PRIORITY = {
    MAIN: 3,
    SUPPORTING: 2,
    BACKGROUND: 1,
};

export const normalizeCharacterRoleName = (value) => (
    String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
);

const getRolePriority = (role) => ROLE_PRIORITY[String(role || '').toUpperCase()] || 0;

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
    (role?.voice_actor?.image ? 1 : 0)
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
