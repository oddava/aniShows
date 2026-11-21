/**
 * Mean score and how many entries it is the mean of, taken from ONE source so
 * the two always agree: the profile payload when it carries `rated_count`,
 * otherwise the list summary (the same numbers the Stats tab shows).
 */
export function profileScore(user, summary) {
    const fromUser = user && user.rated_count != null;
    const source = fromUser ? user : summary;
    if (!source) return { mean: null, rated: 0 };

    let rated = Number(source.rated_count);
    if (!fromUser && source.rated_count == null) {
        const histogram = source.score_histogram || {};
        rated = Object.values(histogram).reduce((sum, count) => sum + (Number(count) || 0), 0);
    }
    rated = Number.isFinite(rated) ? rated : 0;

    const raw = source.mean_score;
    const mean = rated > 0 && raw != null && raw !== '' && Number.isFinite(Number(raw))
        ? Number(raw).toFixed(1)
        : null;
    return { mean, rated };
}

/**
 * Taste in one sentence-case line from the summary's top genres:
 * "Mostly fantasy, romance and action". Null when there is nothing to say.
 */
export function genreLine(genres, limit = 3) {
    const names = (Array.isArray(genres) ? genres : [])
        .filter((genre) => genre?.name && Number(genre.count ?? 1) > 0)
        .slice(0, limit)
        .map((genre) => String(genre.name).toLowerCase());
    if (names.length === 0) return null;
    const list = names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `Mostly ${list}`;
}
