/*
 * The activity feed shows what happened to a list, not every click on the way
 * there. The API returns raw events, newest first; this turns them into the
 * rows people read:
 *
 * - a show whose newest event is a removal is no longer on the list, so none
 *   of its events are shown (the activity payload has no other "still on the
 *   list" signal: `anime.user_list_status` is the viewer's, and unfilled here);
 * - other removals are churn (removed, then added back) and are dropped too,
 *   for visitors always, for the owner unless it is the only event there is;
 * - back-to-back events for one show within about an hour become one row with
 *   the final state; a run that ends where it started is dropped;
 * - when the client already knows a show's current status (list entries it
 *   has loaded anyway, passed as `currentStatus`), a show's newest status row
 *   that ended somewhere else is stale (changed back outside the feed, e.g.
 *   "Completed" while the entry is Watching 3/12) and is dropped.
 */

import { normalizeStatus } from '../../utils/listStatus';

const RUN_WINDOW_MS = 60 * 60 * 1000;
const REMOVED = 'removed';

const animeKey = (activity) => activity?.anime?.id ?? activity?.anime?.slug ?? null;
const timeOf = (activity) => new Date(activity?.created_at).getTime() || 0;
const titleOf = (run) => run[0]?.anime?.title || 'Unknown';

/** The newest status any event in the run moved to (runs are newest first). */
function finalStatus(run) {
    return run.find((activity) => activity.new_status)?.new_status ?? null;
}

/** One event standing for a run of events on one show (newest first). */
function collapseRun(run) {
    if (run.length === 1) return run[0];

    const newest = run[0];
    const oldest = run[run.length - 1];
    const title = titleOf(run);
    const toStatus = finalStatus(run);
    const touchesStatus = run.some((activity) => activity.new_status || activity.old_status);
    const scored = run.find((activity) => activity.new_score)?.new_score ?? null;

    // Added and then moved along: it was added, straight to where it ended up.
    if (oldest.activity_type === 'added') {
        if (newest.activity_type === 'completed') return newest;
        const status = toStatus || oldest.new_status;
        return {
            ...newest,
            activity_type: 'added',
            old_status: null,
            new_status: status,
            activity_description: `Added ${title} to ${status || 'list'}`,
        };
    }

    if (touchesStatus) {
        const fromStatus = oldest.old_status ?? null;
        if (fromStatus && toStatus && fromStatus === toStatus) {
            // Completed → Watching → Completed: nothing changed in the end.
            // Keep the newest thing that wasn't a status flip (an episode, a score), if any.
            const other = run.find((activity) => !activity.new_status && !activity.old_status);
            return other || null;
        }
        if (newest.activity_type === 'completed') {
            return newest.new_score || !scored ? newest : {
                ...newest,
                new_score: scored,
                activity_description: `Completed ${title} and rated it ${scored}/10`,
            };
        }
        if (fromStatus && toStatus) {
            return {
                ...newest,
                activity_type: 'status_change',
                old_status: fromStatus,
                new_status: toStatus,
                activity_description: `Changed ${title} from ${fromStatus} to ${toStatus}`,
            };
        }
        return newest;
    }

    // Episode by episode in one sitting: one row for the stretch.
    if (run.every((activity) => activity.activity_type === 'progress')) {
        const from = oldest.old_episodes;
        const to = newest.new_episodes;
        if (from != null && to != null && to > from) {
            return {
                ...newest,
                old_episodes: from,
                activity_description: to - from === 1
                    ? `Watched episode ${to} of ${title}`
                    : `Watched episodes ${from + 1}-${to} of ${title}`,
            };
        }
    }

    return newest;
}

/** The status a row leaves the show in, if it is a status row at all. */
function resultingStatus(row) {
    if (row.new_status) return normalizeStatus(row.new_status);
    return row.activity_type === 'completed' ? 'Completed' : null;
}

/**
 * Drops each show's newest status row when it contradicts the status the
 * show is known to have now. Older rows are history and stay.
 */
function dropStale(rows, currentStatus) {
    if (!currentStatus || currentStatus.size === 0) return rows;
    const checked = new Set();
    return rows.filter((row) => {
        const key = animeKey(row);
        const status = resultingStatus(row);
        if (key == null || !status || checked.has(key)) return true;
        checked.add(key);
        const current = normalizeStatus(currentStatus.get(key));
        return !current || current === status;
    });
}

/**
 * Current statuses from list entries the client already holds
 * (`{ anime: { id, slug }, status }`), keyed like the feed's events.
 */
export function statusesFromEntries(entries) {
    const map = new Map();
    (entries || []).forEach((entry) => {
        const key = entry?.anime?.id ?? entry?.anime?.slug ?? null;
        if (key != null && entry?.status) map.set(key, entry.status);
    });
    return map;
}

/**
 * @param {Array} activities raw feed events, newest first
 * @param {{ isOwner?: boolean, currentStatus?: Map }} options
 * @returns {Array} the events to show, newest first
 */
export function tidyActivities(activities, { isOwner = false, currentStatus = null } = {}) {
    const events = Array.isArray(activities) ? activities.filter(Boolean) : [];
    if (events.length === 0) return [];
    if (isOwner && events.length === 1) return dropStale(events, currentStatus);

    // Shows that left the list: their newest event is a removal.
    const offList = new Set();
    const seen = new Set();
    events.forEach((activity) => {
        const key = animeKey(activity);
        if (key == null || seen.has(key)) return;
        seen.add(key);
        if (activity.activity_type === REMOVED) offList.add(key);
    });

    const kept = events.filter((activity) => (
        activity.activity_type !== REMOVED && !offList.has(animeKey(activity))
    ));

    // Runs: neighbours for the same show, each within the window of the run's newest.
    const rows = [];
    let run = [];
    const flush = () => {
        if (run.length === 0) return;
        const row = collapseRun(run);
        if (row) rows.push(row);
        run = [];
    };
    kept.forEach((activity) => {
        const head = run[0];
        const sameRun = head
            && animeKey(head) != null
            && animeKey(head) === animeKey(activity)
            && timeOf(head) - timeOf(activity) <= RUN_WINDOW_MS;
        if (!sameRun) flush();
        run.push(activity);
    });
    flush();

    return dropStale(rows, currentStatus);
}

export default tidyActivities;
