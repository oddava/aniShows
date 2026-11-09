import { queryOptions } from '@tanstack/react-query';

import {
    activityApi,
    authApi,
    badgeApi,
    characterFavoriteApi,
    favoriteApi,
    listApi,
    recommendationsApi,
    reviewApi,
    staffFavoriteApi,
} from '../client';

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

export const followKeys = {
    all: ['follows'],
    list: (username, tab) => ['follows', username, tab],
};

export const friendKeys = {
    list: (username) => ['friends-infinite', username],
};

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

export const listKeys = {
    all: ['lists'],
    byStatus: (username, status) => ['lists', username, status],
    overview: (username, status) => ['lists', username, status, 'overview'],
};

export const reviewKeys = {
    all: ['reviews'],
    byUser: (username) => ['reviews', username],
    forAnime: (slug, sort, rating) => ['reviews', slug, sort, rating],
    stats: (slug) => ['reviewStats', slug],
};

export const activityKeys = {
    heatmap: (username) => ['activity-heatmap', username],
    feed: (username, filterType, pageSize) => ['activity-feed', username, filterType, pageSize],
};

export const insightsKeys = {
    /** ProfileInsights: one entry per status. */
    lists: (username) => ['profile-insights-lists', username],
    /** OverviewTab: all statuses flattened. */
    overviewLists: (username) => ['insights-lists', username],
    reviews: (username) => ['insights-reviews', username],
};

export const miniProfileKeys = {
    watching: (username) => ['mini-profile', username, 'watching'],
    favorites: (username) => ['mini-profile', username, 'favorites'],
};

export const badgeKeys = {
    mine: ['myBadges'],
};

export const recommendationKeys = {
    all: ['recommendations'],
};

const LIST_STATUSES = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
const resultsOrData = (res) => res.data.results || res.data || [];

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

export const userQueries = {
    watching: () => queryOptions({
        queryKey: userKeys.watching,
        queryFn: () => listApi.getAll({ status: 'Watching', sort: '-updated_at', limit: 6 })
            .then((res) => res.data.results || res.data),
    }),
};

export const listQueries = {
    byStatus: (username, status) => queryOptions({
        queryKey: listKeys.byStatus(username, status),
        queryFn: () => listApi.getAll({ status, username }).then(resultsOrData),
    }),
    overview: (username, status, pageSize) => queryOptions({
        queryKey: listKeys.overview(username, status),
        queryFn: () => listApi.getAll({
            status,
            username,
            page: 1,
            page_size: pageSize,
        }).then(resultsOrData),
    }),
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

export const reviewQueries = {
    stats: (slug) => queryOptions({
        queryKey: reviewKeys.stats(slug),
        queryFn: () => reviewApi.getStats(slug).then((res) => res.data),
    }),
};

export const activityQueries = {
    heatmap: (username) => queryOptions({
        queryKey: activityKeys.heatmap(username),
        queryFn: () => activityApi.getHeatmap({ username }).then((res) => res.data),
    }),
};

export const insightsQueries = {
    lists: (username) => queryOptions({
        queryKey: insightsKeys.lists(username),
        queryFn: async () => {
            const results = await Promise.all(
                LIST_STATUSES.map((status) =>
                    listApi.getAll({ status, username }).then((res) => {
                        const items = res.data?.results || res.data || [];
                        return {
                            status,
                            items: Array.isArray(items) ? items : [],
                        };
                    }).catch((err) => {
                        console.error(`Failed to fetch list for status ${status}:`, err);
                        return { status, items: [] };
                    }),
                ),
            );
            return results;
        },
    }),
    overviewLists: (username) => queryOptions({
        queryKey: insightsKeys.overviewLists(username),
        queryFn: async () => {
            const results = await Promise.all(
                LIST_STATUSES.map((status) =>
                    listApi.getAll({ status, username }).then(resultsOrData),
                ),
            );
            return results.flat();
        },
    }),
    reviews: (username) => queryOptions({
        queryKey: insightsKeys.reviews(username),
        queryFn: () => reviewApi.getAll({ user: username }).then(resultsOrData),
    }),
};

export const badgeQueries = {
    /** Resolves to the whole axios response (BadgesSettings reads `data.data`). */
    mine: () => queryOptions({
        queryKey: badgeKeys.mine,
        queryFn: () => badgeApi.getMine(),
    }),
};

export const recommendationQueries = {
    all: (limit = 12) => queryOptions({
        queryKey: recommendationKeys.all,
        queryFn: () => recommendationsApi.getAll(limit).then((res) => res.data.results || res.data),
    }),
};
