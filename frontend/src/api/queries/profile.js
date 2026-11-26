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
    /** Viewer-to-profile taste match; under ['profile'] so profile invalidations refresh it. */
    compatibility: (username) => ['profile', username, 'compatibility'],
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

/**
 * Retry policy for profile reads: only server errors (5xx), at most twice.
 * A 4xx such as a private or missing profile's 404 will not change on retry.
 */
export const profileQueryRetry = (failureCount, error) =>
    error?.response?.status >= 500 && failureCount < 2;

export const profileQueries = {
    own: () => queryOptions({
        queryKey: profileKeys.own,
        retry: profileQueryRetry,
        queryFn: async () => {
            const response = await authApi.getProfile(true); // Fetch full profile with stats
            return response.data;
        },
    }),
    byUsername: (username) => queryOptions({
        queryKey: profileKeys.byUsername(username),
        retry: profileQueryRetry,
        queryFn: () => authApi.getByUsername(username).then((res) => res.data),
    }),
    compatibility: (username) => queryOptions({
        queryKey: profileKeys.compatibility(username),
        retry: profileQueryRetry,
        queryFn: () => authApi.getCompatibility(username).then((res) => res.data),
    }),
};
