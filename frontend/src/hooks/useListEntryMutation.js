import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { listApi } from '../api/client';
import { patchAnimeListStatus } from '../api/queries/anime';
import { listKeys } from '../api/queries/lists';
import { profileKeys, userKeys } from '../api/queries/profile';
import logger from '../utils/logger';

const entryState = (entry) => ({
    id: entry?.id ?? null,
    status: entry?.status ?? null,
    episodes_watched: entry?.episodes_watched ?? 0,
});

/**
 * One list entry's writes, shared by every list control (G3 contract, overview section 5).
 *
 * `useListEntryMutation({ anime: { id, slug, episode_count }, entry })` returns
 * `{ entry, setStatus, setProgress, increment, save, remove, startRewatch, isPending }`.
 * `entry` is the `user_list_status` / list-row shape (`id`, `status`, `episodes_watched`).
 *
 * Prep-commit stub: the behaviour of AnimeCard's list menu today. Optimistic local
 * state, rollback and `logger.error` on failure, then the same invalidations
 * (`patchAnimeListStatus` for anime queries, plus lists, the watching shelf and the
 * own profile). Nothing uses it yet; G2's AnimeCard/Home/AnimeDetail and G3's own
 * controls move to it. G3 owns it (toasts, undo, the +1 cap and narrow updates).
 */
export default function useListEntryMutation({ anime, entry } = {}) {
    const queryClient = useQueryClient();
    const [current, setCurrent] = useState(() => entryState(entry));
    const [isPending, setIsPending] = useState(false);
    const animeId = anime?.id;

    useEffect(() => {
        setCurrent(entryState(entry));
    }, [entry?.id, entry?.status, entry?.episodes_watched]); // eslint-disable-line react-hooks/exhaustive-deps

    const invalidate = useCallback(() => {
        patchAnimeListStatus(queryClient, animeId, null);
        queryClient.invalidateQueries({ queryKey: listKeys.all });
        queryClient.invalidateQueries({ queryKey: userKeys.watching });
        queryClient.invalidateQueries({ queryKey: profileKeys.own });
    }, [queryClient, animeId]);

    const run = useCallback(async (optimistic, request) => {
        if (isPending) return null;
        const previous = current;
        setCurrent((state) => ({ ...state, ...optimistic }));
        setIsPending(true);
        try {
            const response = await request(previous);
            if (response?.data?.id) {
                setCurrent((state) => ({ ...state, id: response.data.id }));
            }
            invalidate();
            return response?.data ?? null;
        } catch (error) {
            logger.error('Error updating list:', error);
            setCurrent(previous);
            return null;
        } finally {
            setIsPending(false);
        }
    }, [current, invalidate, isPending]);

    const save = useCallback((fields) => run(fields, (previous) => (
        previous.id
            ? listApi.update(previous.id, fields)
            : listApi.add({ anime_id: animeId, ...fields })
    )), [animeId, run]);

    const setStatus = useCallback((status) => save({ status }), [save]);
    const setProgress = useCallback(
        (episodesWatched) => save({ episodes_watched: episodesWatched }),
        [save],
    );
    const increment = useCallback(
        () => setProgress(current.episodes_watched + 1),
        [current.episodes_watched, setProgress],
    );
    const startRewatch = useCallback(() => save({ is_rewatching: true }), [save]);
    const remove = useCallback(() => run(
        { id: null, status: null },
        (previous) => listApi.remove(previous.id),
    ), [run]);

    return { entry: current, setStatus, setProgress, increment, save, remove, startRewatch, isPending };
}
