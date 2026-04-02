const EMPTY_STATUS_DISTRIBUTION = Object.freeze({
    watching: 0,
    completed: 0,
    on_hold: 0,
    dropped: 0,
    plan_to_watch: 0,
});

const STATUS_KEY_ALIASES = {
    watching: 'watching',
    current: 'watching',
    repeating: 'watching',
    completed: 'completed',
    on_hold: 'on_hold',
    paused: 'on_hold',
    dropped: 'dropped',
    plan_to_watch: 'plan_to_watch',
    planning: 'plan_to_watch',
};

export const createEmptyStatusDistribution = () =>
    ({ ...EMPTY_STATUS_DISTRIBUTION });

export const normalizeStatusDistribution = (distribution) => {
    const normalized = createEmptyStatusDistribution();
    if (!distribution || typeof distribution !== 'object') {
        return normalized;
    }

    Object.entries(distribution).forEach(([rawKey, rawCount]) => {
        const key = rawKey
            ?.toString()
            .trim()
            .toLowerCase()
            .replace(/[-\s]+/g, '_');

        const mappedKey = STATUS_KEY_ALIASES[key];
        if (!mappedKey) return;

        const count = Number.parseInt(rawCount, 10);
        if (!Number.isFinite(count) || count <= 0) return;

        normalized[mappedKey] += count;
    });

    return normalized;
};

export const getStatusDistributionTotal = (distribution) =>
    Object.values(distribution || {}).reduce((sum, count) => {
        const parsed = Number.parseInt(count, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return sum;
        return sum + parsed;
    }, 0);

export const formatCompactCount = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0';
    if (parsed < 1000) return parsed.toString();
    if (parsed < 1000000) return `${Math.floor(parsed / 1000)}k`;
    if (parsed < 1000000000) return `${Math.floor(parsed / 1000000)}m`;
    return `${Math.floor(parsed / 1000000000)}b`;
};
