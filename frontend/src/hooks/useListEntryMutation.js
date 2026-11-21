import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { listApi } from '../api/client';
import { animeKeys, patchAnimeListStatus } from '../api/queries/anime';
import { listKeys } from '../api/queries/lists';
import { profileKeys, userKeys } from '../api/queries/profile';
import logger from '../utils/logger';
import { notify, notifyError } from '../components/ui/toast';
import { statusChangeMessage } from '../utils/listStatus';

/** The writable fields of a list entry, as the API returns and accepts them. */
const ENTRY_FIELDS = [
    'status',
    'score',
    'episodes_watched',
    'notes',
    'started_at',
    'finished_at',
    'total_rewatches',
    'is_rewatching',
];

const EMPTY_ENTRY = Object.freeze({
    id: null,
    status: null,
    score: 0,
    episodes_watched: 0,
    notes: '',
    started_at: null,
    finished_at: null,
    total_rewatches: 0,
    is_rewatching: false,
});

/** Activity rows and the heatmap of the signed-in user change with every list write. */
const ACTIVITY_PREFIXES = [['activity-heatmap'], ['activity-feed']];

export const entryState = (entry) => {
    if (!entry) return { ...EMPTY_ENTRY };
    const state = { ...EMPTY_ENTRY, id: entry.id ?? null };
    ENTRY_FIELDS.forEach((field) => {
        if (entry[field] !== undefined && entry[field] !== null) state[field] = entry[field];
    });
    return state;
};

/** The `user_list_status` shape anime payloads carry (G2 `build_user_list_status_payload`). */
const toUserListStatus = (entry, episodeCount) => {
    if (!entry?.id) return null;
    const total = Number(episodeCount) || 0;
    return {
        id: entry.id,
        ...Object.fromEntries(ENTRY_FIELDS.map((field) => [field, entry[field] ?? EMPTY_ENTRY[field]])),
        progress: total > 0 ? (entry.episodes_watched / total) * 100 : 0,
    };
};

/** What re-adding a removed entry should send so it comes back as it was. */
const restorePayload = (animeId, entry) => {
    const payload = { anime_id: animeId };
    ENTRY_FIELDS.forEach((field) => {
        if (field === 'is_rewatching' && !entry.is_rewatching) return;
        if (entry[field] !== null && entry[field] !== undefined) payload[field] = entry[field];
    });
    return payload;
};

/** The server's reason, in the shapes DRF uses (`detail`, or the first field error). */
export function listErrorMessage(error, fallback = 'Could not update your list.') {
    const data = error?.response?.data;
    if (!data || typeof data !== 'object') return fallback;
    if (typeof data.detail === 'string' && data.detail) return data.detail;
    const first = Object.values(data).find(
        (value) => (typeof value === 'string' && value) || (Array.isArray(value) && value.length > 0),
    );
    if (Array.isArray(first)) return String(first[0]);
    return typeof first === 'string' ? first : fallback;
}

/** The fields an Undo puts back (the server's normaliser may have moved any of them). */
const UNDO_FIELDS = ['status', 'score', 'episodes_watched', 'started_at', 'finished_at', 'is_rewatching', 'total_rewatches'];

/**
 * The toast line for a write: what changed, in words (T6).
 */
export function describeListChange(previous, saved, total = null) {
    if (!saved?.status) return 'Removed from your list';
    if (previous.status !== saved.status) {
        if (saved.status === 'Completed' && previous.status && saved.episodes_watched > previous.episodes_watched) {
            // A show still airing completes up to the aired episode (the server caps it).
            return total && saved.episodes_watched < total
                ? `Completed. Caught up to episode ${saved.episodes_watched}`
                : 'Completed. Every episode marked watched';
        }
        return statusChangeMessage(previous.status, saved.status);
    }
    if (previous.episodes_watched !== saved.episodes_watched) {
        const n = saved.episodes_watched;
        return n === previous.episodes_watched + 1 ? `Episode ${n} watched` : `Progress set to ${n}`;
    }
    if (previous.score !== saved.score) {
        return saved.score ? `Scored ${saved.score}` : 'Score cleared';
    }
    return 'Saved';
}

const knownTotal = (anime) => {
    const total = Number(anime?.episode_count);
    return Number.isFinite(total) && total > 0 ? total : null;
};

/**
 * One list entry's writes, shared by every list control (G3 contract, overview section 5).
 *
 * `useListEntryMutation({ anime: { id, slug, episode_count }, entry })` returns
 * `{ entry, setStatus, setProgress, setScore, increment, save, remove, startRewatch, undo, isPending }`.
 *
 * Every change shows at once (optimistic) together with its toast and Undo; the
 * requests then run one after another in the order they were made, so a quick
 * "Completed" then "9", or five +1 taps, never lose a write, and a later write
 * uses the id an earlier add returned. When an answer arrives the entry adopts
 * what the server saved (its normaliser may move status, progress or dates)
 * with any still-queued changes laid on top. A failed write rolls back to the
 * last saved state and shows the server's reason. Each action resolves to the
 * saved entry, or `null` when nothing was saved.
 *
 * Only the caches a list write can change are refreshed: lists (incl. the summary),
 * the watching shelf, the own profile, own activity, this anime's detail queries, and
 * cached anime lists through G2's `patchAnimeListStatus`.
 */
export default function useListEntryMutation({ anime, entry } = {}) {
    const queryClient = useQueryClient();
    const [current, setCurrentState] = useState(() => entryState(entry));
    const [pendingCount, setPendingCount] = useState(0);
    const currentRef = useRef(current);
    // What the server last confirmed, and the changes still waiting for it.
    const confirmedRef = useRef(current);
    const queuedRef = useRef([]);
    const chainRef = useRef(Promise.resolve());
    const animeId = anime?.id;
    const slug = anime?.slug;
    const episodeCount = anime?.episode_count;

    const setCurrent = useCallback((next) => {
        currentRef.current = next;
        setCurrentState(next);
    }, []);

    useEffect(() => {
        if (queuedRef.current.length > 0) return;
        const next = entryState(entry);
        confirmedRef.current = next;
        setCurrent(next);
    }, [ // eslint-disable-line react-hooks/exhaustive-deps
        entry?.id, entry?.status, entry?.score, entry?.episodes_watched, entry?.notes,
        entry?.started_at, entry?.finished_at, entry?.total_rewatches, entry?.is_rewatching,
    ]);

    const refreshCaches = useCallback((saved) => {
        patchAnimeListStatus(queryClient, animeId, toUserListStatus(saved, episodeCount));
        queryClient.invalidateQueries({ queryKey: listKeys.all });
        queryClient.invalidateQueries({ queryKey: userKeys.watching });
        queryClient.invalidateQueries({ queryKey: profileKeys.own });
        ACTIVITY_PREFIXES.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
        if (slug) queryClient.invalidateQueries({ queryKey: animeKeys.bySlug(slug) });
    }, [queryClient, animeId, slug, episodeCount]);

    const undoRef = useRef(null);

    /** The still-queued optimistic changes, oldest first. */
    const queuedOverlay = () => Object.assign({}, ...queuedRef.current.map((op) => op.optimistic));

    /**
     * Show `optimistic` now (with its toast unless `silent`), then queue
     * `request(confirmed)`: it runs after every earlier write and receives the
     * last server-confirmed entry (so it knows the id an earlier add returned).
     */
    const run = useCallback((optimistic, request, { silent = false } = {}) => {
        const before = currentRef.current;
        const op = { optimistic };
        queuedRef.current = [...queuedRef.current, op];
        setPendingCount((count) => count + 1);
        setCurrent({ ...before, ...optimistic });

        const toastId = `list-${animeId}`;
        const onUndo = () => undoRef.current?.(before);
        const shownMessage = silent ? null : describeListChange(before, { ...before, ...optimistic }, knownTotal({ episode_count: episodeCount }));
        if (shownMessage) notify(shownMessage, { id: toastId, onUndo });

        const finish = () => {
            queuedRef.current = queuedRef.current.filter((queued) => queued !== op);
            setPendingCount((count) => count - 1);
        };

        const execute = async () => {
            try {
                const response = await request(confirmedRef.current);
                const saved = response?.data?.id ? entryState(response.data) : entryState(null);
                finish();
                confirmedRef.current = saved;
                setCurrent({ ...saved, ...queuedOverlay() });
                refreshCaches(saved);
                if (shownMessage) {
                    // The server may have done more (Completed fills progress): say so.
                    const savedMessage = describeListChange(before, saved, knownTotal({ episode_count: episodeCount }));
                    if (savedMessage !== shownMessage) notify(savedMessage, { id: toastId, onUndo });
                }
                return { previous: before, saved };
            } catch (error) {
                logger.error('Error updating list:', error);
                finish();
                setCurrent({ ...confirmedRef.current, ...queuedOverlay() });
                notifyError(listErrorMessage(error), { id: toastId });
                return null;
            }
        };

        const result = chainRef.current.then(execute, execute);
        chainRef.current = result.catch(() => null);
        return result;
    }, [animeId, refreshCaches, setCurrent]);

    const save = useCallback(async (fields, options) => {
        const result = await run(fields, (confirmed) => (
            confirmed.id
                ? listApi.update(confirmed.id, fields)
                : listApi.add({ anime_id: animeId, ...fields })
        ), options);
        return result?.saved ?? null;
    }, [animeId, run]);

    const setStatus = useCallback((status, options) => save({ status }, options), [save]);

    const setScore = useCallback(
        (score, options) => save({ score: Math.max(0, Math.min(10, Math.trunc(Number(score) || 0))) }, options),
        [save],
    );

    const setProgress = useCallback((episodesWatched, options) => {
        const total = knownTotal({ episode_count: episodeCount });
        const capped = Math.max(0, total ? Math.min(episodesWatched, total) : episodesWatched);
        if (capped === (currentRef.current.episodes_watched || 0)) return Promise.resolve(null);
        return save({ episodes_watched: capped }, options);
    }, [episodeCount, save]);

    const increment = useCallback(() => {
        const total = knownTotal({ episode_count: episodeCount });
        const watched = currentRef.current.episodes_watched || 0;
        if (total && watched >= total) return Promise.resolve(null);
        return setProgress(watched + 1);
    }, [episodeCount, setProgress]);

    const startRewatch = useCallback(() => save({ is_rewatching: true }), [save]);

    /**
     * Put the entry back the way it was before a write: re-add a removed
     * entry, remove a just-added one, or restore the fields a write changed.
     * Queued like any write, so it lands after the write it undoes.
     */
    const undo = useCallback((previous) => {
        if (!previous.status) {
            return run(EMPTY_ENTRY, (confirmed) => (
                confirmed.id ? listApi.remove(confirmed.id) : Promise.resolve({})
            ), { silent: true });
        }
        const fields = Object.fromEntries(UNDO_FIELDS.map((field) => [field, previous[field] ?? EMPTY_ENTRY[field]]));
        return run(fields, (confirmed) => (
            confirmed.id
                ? listApi.update(confirmed.id, fields)
                : listApi.add(restorePayload(animeId, previous))
        ), { silent: true });
    }, [animeId, run]);

    useEffect(() => {
        undoRef.current = undo;
    }, [undo]);

    const remove = useCallback(async () => {
        if (!currentRef.current.status) return null;
        const result = await run(EMPTY_ENTRY, (confirmed) => (
            confirmed.id ? listApi.remove(confirmed.id) : Promise.resolve({})
        ));
        return result ? result.saved : null;
    }, [run]);

    return {
        entry: current,
        setStatus,
        setProgress,
        setScore,
        increment,
        save,
        remove,
        startRewatch,
        undo,
        isPending: pendingCount > 0,
    };
}
