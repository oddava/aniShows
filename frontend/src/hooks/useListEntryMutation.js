import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { listApi } from '../api/client';
import { animeKeys, patchAnimeListStatus } from '../api/queries/anime';
import { listKeys } from '../api/queries/lists';
import { profileKeys, userKeys } from '../api/queries/profile';
import logger from '../utils/logger';

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

const knownTotal = (anime) => {
    const total = Number(anime?.episode_count);
    return Number.isFinite(total) && total > 0 ? total : null;
};

/**
 * One list entry's writes, shared by every list control (G3 contract, overview section 5).
 *
 * `useListEntryMutation({ anime: { id, slug, episode_count }, entry })` returns
 * `{ entry, setStatus, setProgress, increment, save, remove, startRewatch, isPending }`.
 * `entry` is the `user_list_status` / list-row shape. Every write is optimistic, rolls
 * back with an error toast carrying the server's message, and then adopts the entry
 * the server returns (its normaliser may change status, progress or dates). Each
 * action resolves to the saved entry, or `null` when nothing was saved.
 *
 * Only the caches a list write can change are refreshed: lists (incl. the summary),
 * the watching shelf, the own profile, own activity, this anime's detail queries, and
 * cached anime lists through G2's `patchAnimeListStatus`.
 */
export default function useListEntryMutation({ anime, entry } = {}) {
    const queryClient = useQueryClient();
    const [current, setCurrentState] = useState(() => entryState(entry));
    const [isPending, setIsPending] = useState(false);
    const currentRef = useRef(current);
    const inFlight = useRef(false);
    const animeId = anime?.id;
    const slug = anime?.slug;
    const episodeCount = anime?.episode_count;

    const setCurrent = useCallback((next) => {
        currentRef.current = next;
        setCurrentState(next);
    }, []);

    useEffect(() => {
        if (!inFlight.current) setCurrent(entryState(entry));
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

    /** Apply `optimistic` now, send `request(previous)`, then adopt the server entry. */
    const run = useCallback(async (optimistic, request) => {
        if (inFlight.current) return null;
        inFlight.current = true;
        const previous = currentRef.current;
        setCurrent({ ...previous, ...optimistic });
        setIsPending(true);
        try {
            const response = await request(previous);
            const saved = response?.data?.id ? entryState(response.data) : entryState(null);
            setCurrent(saved);
            refreshCaches(saved);
            return { previous, saved };
        } catch (error) {
            logger.error('Error updating list:', error);
            setCurrent(previous);
            toast.error(listErrorMessage(error));
            return null;
        } finally {
            inFlight.current = false;
            setIsPending(false);
        }
    }, [refreshCaches, setCurrent]);

    const save = useCallback(async (fields) => {
        const result = await run(fields, (previous) => (
            previous.id
                ? listApi.update(previous.id, fields)
                : listApi.add({ anime_id: animeId, ...fields })
        ));
        return result?.saved ?? null;
    }, [animeId, run]);

    const setStatus = useCallback((status) => save({ status }), [save]);

    const setProgress = useCallback((episodesWatched) => {
        const total = knownTotal({ episode_count: episodeCount });
        const capped = Math.max(0, total ? Math.min(episodesWatched, total) : episodesWatched);
        return save({ episodes_watched: capped });
    }, [episodeCount, save]);

    const increment = useCallback(() => {
        const total = knownTotal({ episode_count: episodeCount });
        const watched = currentRef.current.episodes_watched || 0;
        if (total && watched >= total) return Promise.resolve(null);
        return setProgress(watched + 1);
    }, [episodeCount, setProgress]);

    const startRewatch = useCallback(() => save({ is_rewatching: true }), [save]);

    const undoRemove = useCallback((removed) => run(
        removed,
        () => listApi.add(restorePayload(animeId, removed)),
    ), [animeId, run]);

    const remove = useCallback(async () => {
        if (!currentRef.current.id) return null;
        const result = await run(EMPTY_ENTRY, (previous) => listApi.remove(previous.id));
        if (!result) return null;
        toast((toastInstance) => createElement(
            'span',
            { className: 'flex items-center gap-3' },
            'Removed',
            createElement('button', {
                type: 'button',
                className: 'font-bold text-accent hover:underline',
                onClick: () => {
                    toast.dismiss(toastInstance.id);
                    undoRemove(result.previous);
                },
            }, 'Undo'),
        ), { id: `list-removed-${animeId}` });
        return result.saved;
    }, [animeId, run, undoRemove]);

    return { entry: current, setStatus, setProgress, increment, save, remove, startRewatch, isPending };
}
