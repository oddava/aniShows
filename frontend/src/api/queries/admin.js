import { queryOptions } from '@tanstack/react-query';

import api, { adminBadgeApi } from '../client';

/*
 * Query keys for the admin area. These live under their own roots, so no
 * public-site invalidation (['anime'], ['profile'], ...) touches them.
 */
export const adminBadgeKeys = {
    all: ['adminBadges'],
    list: (page, search) => ['adminBadges', page, search],
    holdersAll: (badgeId) => ['adminBadgeHolders', badgeId],
    holders: (badgeId, page) => ['adminBadgeHolders', badgeId, page],
    userSearch: (term) => ['adminUsersSearch', term],
};

// adminBadgeApi returns the axios response; AdminBadges reads `data.data`.
export const adminBadgeQueries = {
    list: (page, search) => queryOptions({
        queryKey: adminBadgeKeys.list(page, search),
        queryFn: () => adminBadgeApi.getAll({ page, search }),
    }),
    holders: (badgeId, page) => queryOptions({
        queryKey: adminBadgeKeys.holders(badgeId, page),
        queryFn: () => adminBadgeApi.getHolders(badgeId, { page }),
    }),
    userSearch: (term) => queryOptions({
        queryKey: adminBadgeKeys.userSearch(term),
        queryFn: () => api.get('/admin/users/', { params: { search: term, page_size: 5 } }),
    }),
};

/*
 * The other admin pages. `resource` is the path under /api/v1/admin/
 * ('users', 'anime', 'reviews/reports', ...). Invalidating
 * `adminKeys.resource(resource)` refetches every page/filter of that list.
 */
export const adminKeys = {
    all: ['admin'],
    resource: (resource) => ['admin', resource],
    list: (resource, params) => ['admin', resource, 'list', params],
    stats: (resource) => ['admin', resource, 'stats'],
    dashboard: () => ['admin', 'dashboard'],
    settings: () => ['admin', 'settings'],
    reportsAll: () => ['admin', 'reports'],
    /** Index 2 is the tab; AdminReports relies on that to keep placeholders per tab. */
    report: (tab, days) => ['admin', 'reports', tab, days],
};

const data = (res) => res.data;

/** `/admin/<resource>/?a=1&b=2`, built the way the pages always built it. */
export const adminListUrl = (resource, params) => `/admin/${resource}/?${new URLSearchParams(params)}`;

export const adminQueries = {
    /** One page of a DRF-paginated admin list: resolves to `{ results, count, ... }`. */
    list: (resource, params) => queryOptions({
        queryKey: adminKeys.list(resource, params),
        queryFn: ({ signal }) => api.get(adminListUrl(resource, params), { signal }).then(data),
    }),
    stats: (resource) => queryOptions({
        queryKey: adminKeys.stats(resource),
        queryFn: ({ signal }) => api.get(`/admin/${resource}/stats/`, { signal }).then(data),
    }),
    dashboard: () => queryOptions({
        queryKey: adminKeys.dashboard(),
        queryFn: ({ signal }) => api.get('/admin/dashboard/', { signal }).then(data),
    }),
    settings: () => queryOptions({
        queryKey: adminKeys.settings(),
        queryFn: ({ signal }) => api.get('/admin/settings/', { signal }).then(data),
    }),
};
