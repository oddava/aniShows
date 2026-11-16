// Query keys and options owned by G2 Browse & discover (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { recommendationsApi } from '../client';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const recommendationKeys = {
    all: ['recommendations'],
};

export const recommendationQueries = {
    all: (limit = 12) => queryOptions({
        queryKey: recommendationKeys.all,
        queryFn: () => recommendationsApi.getAll(limit).then((res) => res.data.results || res.data),
    }),
};

export const recommendationMutations = {
    /*
     * "Not interested": the card leaves the cached list at once and comes
     * back if the request fails. No refetch on success: the server keeps the
     * row dismissed, and the cached list already matches it.
     */
    dismiss: (queryClient) => ({
        mutationFn: (animeId) => recommendationsApi.dismiss(animeId),
        onMutate: async (animeId) => {
            await queryClient.cancelQueries({ queryKey: recommendationKeys.all });
            const previous = queryClient.getQueryData(recommendationKeys.all);
            queryClient.setQueryData(recommendationKeys.all, (current) => (
                Array.isArray(current)
                    ? current.filter((rec) => rec?.anime?.id !== animeId)
                    : current
            ));
            return { previous };
        },
        onError: (_error, _animeId, context) => {
            if (context && context.previous !== undefined) {
                queryClient.setQueryData(recommendationKeys.all, context.previous);
            }
        },
    }),
};
