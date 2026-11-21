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
 * The score in words: "average 7.7 from 3 scores" (one score: "from 1 score").
 * Null when nothing is scored.
 */
export function scoreLine({ mean, rated }) {
    if (!rated || mean == null) return null;
    return `average ${mean} from ${rated.toLocaleString()} ${rated === 1 ? 'score' : 'scores'}`;
}

/**
 * How much of the list carries a score: "3 of 7 scored", "All 7 scored".
 * The Stats tab's note, so it adds to the header's average instead of
 * repeating it. Null when nothing is scored or the total is unknown.
 */
export function scoredShareLine(rated, total) {
    if (!rated || !total) return null;
    if (rated >= total && total > 1) return `All ${total.toLocaleString()} scored`;
    return `${rated.toLocaleString()} of ${total.toLocaleString()} scored`;
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
