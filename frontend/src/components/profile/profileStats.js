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
