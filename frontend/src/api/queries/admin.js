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
