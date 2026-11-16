// Query keys and options owned by G5 Community (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { characterFavoriteApi, favoriteApi, staffFavoriteApi } from '../client';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const favoriteKeys = {
    byUser: (username) => ['favorites', username],
    overview: (username) => ['favorites-overview', username],
};

export const characterFavoriteKeys = {
    byUser: (username) => ['character-favorites', username],
    overview: (username) => ['character-favorites', username, 'overview'],
};

export const staffFavoriteKeys = {
    byUser: (username) => ['staff-favorites', username],
    overview: (username) => ['staff-favorites', username, 'overview'],
};

export const favoriteQueries = {
    overview: (username, pageSize) => queryOptions({
        queryKey: favoriteKeys.overview(username),
        queryFn: () => favoriteApi.getAll({ username, page: 1, page_size: pageSize }).then((res) => res.data),
    }),
};

export const characterFavoriteQueries = {
    overview: (username, pageSize) => queryOptions({
        queryKey: characterFavoriteKeys.overview(username),
        queryFn: () => characterFavoriteApi.getAll({ username, page: 1, page_size: pageSize }).then((res) => res.data),
    }),
};

export const staffFavoriteQueries = {
    overview: (username, pageSize) => queryOptions({
        queryKey: staffFavoriteKeys.overview(username),
        queryFn: () => staffFavoriteApi.getAll({ username, page: 1, page_size: pageSize }).then((res) => res.data),
    }),
};
