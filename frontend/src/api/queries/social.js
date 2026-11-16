// Query keys and options owned by G5 Community (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { followApi } from '../client';
import { getApiErrorMessage } from '../errors';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const followKeys = {
    all: ['follows'],
    list: (username, tab) => ['follows', username, tab],
    /** A server-side `?search=` of one tab; covered by `list(username, tab)`. */
    search: (username, tab, search) => ['follows', username, tab, { search }],
};

export const friendKeys = {
    list: (username) => ['friends-infinite', username],
};

export const friendsWatchingKeys = {
    all: ['friendsWatching'],
    byAnime: (animeId) => ['friendsWatching', animeId],
};

/** The copy every community write shows when the server throttles (429). */
export const THROTTLED_MESSAGE = 'You are doing that too fast. Please wait a moment.';

/** Toast text for a failed follow/favorite write: throttle copy, else the envelope's `detail`. */
export const getCommunityErrorMessage = (error, fallback) => (
    error?.response?.status === 429 ? THROTTLED_MESSAGE : getApiErrorMessage(error, fallback)
);

/**
 * `{results, total}` from a friends-watching response. The body is a list (capped
 * at 50); the uncapped total comes in the `X-Total-Count` header. A `{results,
 * total}` body is tolerated too.
 */
export const normalizeFriendsWatching = (payload, headers = {}) => {
    const results = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.results) ? payload.results : []);
    const headerTotal = Number.parseInt(headers?.['x-total-count'], 10);
    const bodyTotal = Array.isArray(payload) ? NaN : Number(payload?.total);
    const total = [headerTotal, bodyTotal].find((value) => Number.isFinite(value) && value >= results.length);
    return { results, total: total ?? results.length };
};

export const socialQueries = {
    /**
     * Mutual follows with this anime on their list. Callers add
     * `enabled: isAuthenticated` (the endpoint needs a signed-in viewer).
     */
    friendsWatching: (animeId) => queryOptions({
        queryKey: friendsWatchingKeys.byAnime(animeId),
        queryFn: () => followApi.getFriendsWatching(animeId).then((res) => normalizeFriendsWatching(res.data, res.headers)),
        staleTime: 60 * 1000,
        enabled: animeId !== undefined && animeId !== null && animeId !== '',
    }),
};
