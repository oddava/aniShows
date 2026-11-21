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
