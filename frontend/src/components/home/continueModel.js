import { airingState, knownEpisodeTotal } from '../../utils/episodes';

/**
 * Where a Watching entry stands tonight, for the Continue row (L2):
 * - `ready`: episodes have aired that you haven't watched (`behind` of them);
 * - `finished`: you've watched every episode: score it, mark it Completed;
 * - `soon`: up to date, the next episode airs at `nextAt`;
 * - `idle`: nothing known about what's next.
 */
export function continueState(entry, now = Date.now()) {
    const anime = entry?.anime || {};
    const watched = Number(entry?.episodes_watched) || 0;
    const total = knownEpisodeTotal(anime);
    // An episode whose airing time has passed is out, even before the API's
    // sync moves next_airing_* on to the following one.
    const airing = airingState(anime, now);
    const nextAt = airing.nextAt;
    const hasNext = nextAt !== null && nextAt > now;
    let aired = airing.aired;
    if (aired === null && anime.status === 'Finished' && total) aired = total;

    if (total && watched >= total) return { kind: 'finished', watched, total };
    const behind = aired !== null ? Math.max(0, aired - watched) : 0;
    if (behind > 0) return { kind: 'ready', watched, total, behind, nextEpisode: watched + 1, nextAt: hasNext ? nextAt : null };
    if (hasNext) return { kind: 'soon', watched, total, nextEpisode: airing.nextEpisode || watched + 1, nextAt };
    return { kind: 'idle', watched, total };
}

const ORDER = { ready: 0, finished: 1, soon: 2, idle: 3 };

/** Ready to watch first, then finished (to score), then by what airs soonest. */
export function sortForContinue(entries, now = Date.now()) {
    return [...(entries || [])]
        .map((entry) => ({ entry, state: continueState(entry, now) }))
        .sort((a, b) => {
            const byKind = ORDER[a.state.kind] - ORDER[b.state.kind];
            if (byKind) return byKind;
            const at = a.state.nextAt ?? Infinity;
            const bt = b.state.nextAt ?? Infinity;
            if (at !== bt) return at - bt;
            return Date.parse(b.entry.updated_at || 0) - Date.parse(a.entry.updated_at || 0);
        });
}

/** "2h 21m", "1d 3h", "14m". */
export function countdown(nextAt, now = Date.now()) {
    const minutes = Math.max(0, Math.round((nextAt - now) / 60000));
    const hours = Math.floor(minutes / 60);
    if (hours < 1) return `${minutes}m`;
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
