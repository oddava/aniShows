/*
 * Each profile number carries an aura that changes colour as it grows, the
 * way Mobile Legends profile counters do: no level, no rank, nothing to
 * compete over; just a number that looks more alive the more you have
 * watched. Thresholds are per metric, since 100 shows and 100 episodes are
 * not the same amount of watching.
 */

export const AURA_TIERS = [
    { tier: 1, name: 'Green', color: '#86cc90' },
    { tier: 2, name: 'Blue', color: '#8db1ff' },
    { tier: 3, name: 'Purple', color: '#b8a5ff' },
    { tier: 4, name: 'Gold', color: '#f2c14e' },
    { tier: 5, name: 'Ruby', color: '#ff4757' },
];

export const AURA_THRESHOLDS = {
    anime: [25, 100, 250, 500, 1000],
    episodes: [300, 1500, 4000, 8000, 15000],
    days: [5, 25, 60, 120, 250],
    completed: [20, 75, 200, 400, 800],
};

/** The aura for `value` of `metric`: tier 0 (none) up to 5, with its colour. */
export function statAura(metric, value) {
    const thresholds = AURA_THRESHOLDS[metric] || [];
    const count = Number(value) || 0;
    let tier = 0;
    thresholds.forEach((threshold, index) => {
        if (count >= threshold) tier = index + 1;
    });
    const meta = AURA_TIERS[tier - 1] || null;
    return { tier, color: meta?.color || null, name: meta?.name || null };
}
