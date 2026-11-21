/** Total episodes when known (> 0), else null. */
export function knownEpisodeTotal(anime) {
    const total = Number(anime?.episode_count);
    return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Episodes aired so far when the total is unknown (long runners such as
 * ONE PIECE): the next airing episode minus one (D2). Null when unknown.
 */
export function airedEpisodeCount(anime) {
    const next = Number(anime?.next_airing_episode);
    if (Number.isFinite(next) && next > 1) return next - 1;
    return null;
}

/** "Ep 13 / 24", "Ep 13 / 1180 aired", "Ep 13". */
export function progressText(watched, anime) {
    const n = Number(watched) || 0;
    const total = knownEpisodeTotal(anime);
    if (total) return `Ep ${Math.min(n, total)} / ${total}`;
    const aired = airedEpisodeCount(anime);
    return aired ? `Ep ${n} / ${aired} aired` : `Ep ${n}`;
}

/** Share watched, 0–100, or null when there is nothing to measure against. */
export function progressPercent(watched, anime) {
    const base = knownEpisodeTotal(anime) || airedEpisodeCount(anime);
    if (!base) return null;
    return Math.max(0, Math.min(100, ((Number(watched) || 0) / base) * 100));
}
