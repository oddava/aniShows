// Query keys and options owned by G5 Community (feature-revamp seams).
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { characterFavoriteApi, favoriteApi, staffFavoriteApi } from '../client';
import { getCommunityErrorMessage } from './social';

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
    /** Every favorite at once (reorder mode); covered by `byUser(username)`. */
    allForReorder: (username) => ['favorites', username, 'all'],
};

export const characterFavoriteKeys = {
    byUser: (username) => ['character-favorites', username],
    overview: (username) => ['character-favorites', username, 'overview'],
    /** Every page, for the profile's Favorites tab; covered by `byUser(username)`. */
    all: (username) => ['character-favorites', username, 'all'],
};

export const staffFavoriteKeys = {
    byUser: (username) => ['staff-favorites', username],
    overview: (username) => ['staff-favorites', username, 'overview'],
    /** Every page, for the profile's Favorites tab; covered by `byUser(username)`. */
    all: (username) => ['staff-favorites', username, 'all'],
};

/** Reorder mode loads at most this many favorites (the server's reorder cap). */
export const FAVORITES_REORDER_CAP = 500;
const REORDER_PAGE_SIZE = 200;

const nextPageNumber = (next) => {
    if (!next) return null;
    try {
        const page = Number(new URL(next, 'http://localhost').searchParams.get('page'));
        return Number.isFinite(page) && page > 0 ? page : null;
    } catch {
        return null;
    }
};

/** Fetches every favorite (200 per page, following `next`, capped at 500). */
export const fetchAllFavorites = async (username) => {
    const results = [];
    let page = 1;
    let count = 0;
    while (page && results.length < FAVORITES_REORDER_CAP) {
        const { data } = await favoriteApi.getAll({ username, page, page_size: REORDER_PAGE_SIZE });
        const isArray = Array.isArray(data);
        results.push(...(isArray ? data : (data?.results || [])));
        count = isArray ? results.length : (data?.count ?? results.length);
        const next = isArray ? null : nextPageNumber(data?.next);
        page = next && next > page ? next : null;
    }
    return { results: results.slice(0, FAVORITES_REORDER_CAP), count };
};

export const favoriteQueries = {
    overview: (username, pageSize) => queryOptions({
        queryKey: favoriteKeys.overview(username),
        queryFn: () => favoriteApi.getAll({ username, page: 1, page_size: pageSize }).then((res) => res.data),
    }),
    allForReorder: (username) => queryOptions({
        queryKey: favoriteKeys.allForReorder(username),
        queryFn: () => fetchAllFavorites(username),
        staleTime: 0,
    }),
};

/** Favourite characters / voice actors per page on the Favorites tab. */
export const PEOPLE_PAGE_SIZE = 48;

/** A paged list of one person kind, `Load more` following the server's `next`. */
const allPeople = (queryKey, getAll, username) => infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }) => getAll({ username, page: pageParam, page_size: PEOPLE_PAGE_SIZE }).then((res) => res.data),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (lastPage?.next ? pages.length + 1 : undefined),
});

export const characterFavoriteQueries = {
    overview: (username, pageSize) => queryOptions({
        queryKey: characterFavoriteKeys.overview(username),
        queryFn: () => characterFavoriteApi.getAll({ username, page: 1, page_size: pageSize }).then((res) => res.data),
    }),
    all: (username) => allPeople(characterFavoriteKeys.all(username), (params) => characterFavoriteApi.getAll(params), username),
};

export const staffFavoriteQueries = {
    overview: (username, pageSize) => queryOptions({
        queryKey: staffFavoriteKeys.overview(username),
        queryFn: () => staffFavoriteApi.getAll({ username, page: 1, page_size: pageSize }).then((res) => res.data),
    }),
    all: (username) => allPeople(staffFavoriteKeys.all(username), (params) => staffFavoriteApi.getAll(params), username),
};

// Resolved lazily so module mocks of '../client' are read at call time.
const TOGGLE_CONFIG = {
    anime: { api: () => favoriteApi, roots: [['favorites'], ['favorites-overview'], ['mini-profile']] },
    character: { api: () => characterFavoriteApi, roots: [['character-favorites']] },
    staff: { api: () => staffFavoriteApi, roots: [['staff-favorites']] },
};

/**
 * Toggle an anime/character/staff favorite: `mutate(id)` resolves to the
 * server's `{is_favorite, favorite_count, message}` and invalidates that
 * kind's favorite lists. Errors toast (throttle copy on 429) unless the
 * caller passes its own `onError`. The detail page's own cache (e.g. the
 * anime payload's `is_favorite`) is the caller's to update in `onSuccess`.
 */
export function useToggleFavorite(kind, { onSuccess, onError } = {}) {
    const queryClient = useQueryClient();
    const config = TOGGLE_CONFIG[kind];
    if (!config) throw new Error(`useToggleFavorite: unknown kind "${kind}"`);

    return useMutation({
        mutationFn: (id) => config.api().toggle(id).then((res) => res.data),
        onSuccess: (data, id, context) => {
            config.roots.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
            onSuccess?.(data, id, context);
        },
        onError: (error, id, context) => {
            if (onError) {
                onError(error, id, context);
                return;
            }
            toast.error(getCommunityErrorMessage(error, 'Could not update favorites. Please try again.'));
        },
    });
}
