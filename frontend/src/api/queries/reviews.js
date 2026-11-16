// Query keys and options owned by G5 Community (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { reviewApi } from '../client';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const reviewKeys = {
    all: ['reviews'],
    byUser: (username) => ['reviews', username],
    forAnime: (slug, sort, rating) => ['reviews', slug, sort, rating],
    stats: (slug) => ['reviewStats', slug],
};

export const reviewQueries = {
    stats: (slug) => queryOptions({
        queryKey: reviewKeys.stats(slug),
        queryFn: () => reviewApi.getStats(slug).then((res) => res.data),
    }),
};
