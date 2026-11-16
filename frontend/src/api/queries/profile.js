// Query keys and options owned by G1 Accounts & auth (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { authApi } from '../client';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

/** The signed-in user's full profile (useUserProfile) and other profiles by username. */
export const profileKeys = {
    own: ['ownProfile'],
    all: ['profile'],
    byUsername: (username) => ['profile', username],
    /** Written optimistically by FollowButton; no query reads it today. */
    me: ['profile', 'me'],
};

export const userKeys = {
    /** Written optimistically by FollowButton; no query reads these today. */
    byUsername: (username) => ['user', username],
    me: ['user', 'me'],
    /** Home "continue watching" row. */
    watching: ['user', 'list', 'watching'],
    /** Invalidated by BadgesSettings; no query reads it today. */
    profileLegacy: ['userProfile'],
};

export const miniProfileKeys = {
    watching: (username) => ['mini-profile', username, 'watching'],
    favorites: (username) => ['mini-profile', username, 'favorites'],
};

export const profileQueries = {
    own: () => queryOptions({
        queryKey: profileKeys.own,
        queryFn: async () => {
            const response = await authApi.getProfile(true); // Fetch full profile with stats
            return response.data;
        },
    }),
    byUsername: (username) => queryOptions({
        queryKey: profileKeys.byUsername(username),
        queryFn: () => authApi.getByUsername(username).then((res) => res.data),
    }),
};
