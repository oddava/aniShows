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
