// Query keys and options owned by G3 Lists (feature-revamp seams).
import { queryOptions } from '@tanstack/react-query';

import { activityApi, listApi, reviewApi } from '../client';
import { userKeys } from './profile';

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

const LIST_STATUSES = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
const resultsOrData = (res) => res.data.results || res.data || [];

export const listKeys = {
    all: ['lists'],
    byStatus: (username, status) => ['lists', username, status],
    overview: (username, status) => ['lists', username, status, 'overview'],
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
