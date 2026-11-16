// Query keys and options owned by G5 Community (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { badgeApi } from '../client';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const badgeKeys = {
    mine: ['myBadges'],
};

export const badgeQueries = {
    /** Resolves to the whole axios response (BadgesSettings reads `data.data`). */
    mine: () => queryOptions({
        queryKey: badgeKeys.mine,
        queryFn: () => badgeApi.getMine(),
    }),
};
