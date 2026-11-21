/** Total episodes when known (> 0), else null. */
export function knownEpisodeTotal(anime) {
    const total = Number(anime?.episode_count);
    return Number.isFinite(total) && total > 0 ? total : null;
}

const toMs = (now) => (now instanceof Date ? now.getTime() : Number(now));

/**
 * What has aired, one truth for every screen. The API's next_airing_date and
 * next_airing_episode stay on an episode until a background sync advances
 * them, so a next_airing_date at or before `now` means that episode is out.
 *
 * - `aired`: episodes out so far (null when unknown), never above the total;
 * - `justAired`: the API's "next" episode has in fact aired (`airedAt` is when);
 * - `nextEpisode` / `nextAt`: the episode still to come and when it airs
 *   (`nextAt` null when not known, e.g. right after an episode aired).
 *
 * Mirrors `_aired_so_far` in apps/users/services/list_rules.py.
 */
export function airingState(anime, now = Date.now()) {
    const total = knownEpisodeTotal(anime);
    const next = Number(anime?.next_airing_episode);
    const at = Date.parse(anime?.next_airing_date);
    const hasNext = Number.isFinite(next) && next >= 1;
    const hasAt = Number.isFinite(at);
    const justAired = hasNext && hasAt && at <= toMs(now);

    let aired = null;
    if (hasNext) {
        const count = justAired ? next : next - 1;
        aired = count > 0 ? count : null;
    }
    if (aired !== null && total) aired = Math.min(aired, total);

    if (justAired) {
        const more = !total || next < total;
        return { aired, justAired, airedAt: at, nextEpisode: more ? next + 1 : null, nextAt: null };
    }
    return {
        aired,
        justAired: false,
        airedAt: null,
        nextEpisode: hasNext ? next : null,
        nextAt: hasNext && hasAt ? at : null,
    };
}

/**
 * Episodes aired so far (see airingState): the next airing episode minus one,
 * or that episode too once its airing time has passed. Null when unknown.
 */
export function airedEpisodeCount(anime, now = Date.now()) {
    return airingState(anime, now).aired;
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
