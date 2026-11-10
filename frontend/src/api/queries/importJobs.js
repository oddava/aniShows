import { queryOptions } from '@tanstack/react-query';

import { importExportApi } from '../client';

/* The signed-in user's list imports (MAL / AniList / XML) on /import. */
export const importJobKeys = {
    all: ['importJobs'],
    forUser: (userId) => ['importJobs', userId ?? 'anonymous'],
    list: (userId) => ['importJobs', userId ?? 'anonymous', 'list'],
    detail: (userId, jobId) => ['importJobs', userId ?? 'anonymous', 'detail', jobId],
};

export const ACTIVE_IMPORT_STATUSES = ['pending', 'processing'];

/** The jobs endpoint has answered both as a bare list and as a DRF page. */
export const normalizeJobsResponse = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && Array.isArray(payload.results)) {
        return payload.results;
    }

    return [];
};

export const importJobQueries = {
    list: (userId) => queryOptions({
        queryKey: importJobKeys.list(userId),
        queryFn: () => importExportApi.getImportJobs().then((response) => normalizeJobsResponse(response.data)),
    }),
    /**
     * One job, re-read every 2 seconds while it is pending or processing.
     * A failed read stops the polling, as the old setTimeout chain did.
     */
    status: (userId, jobId) => queryOptions({
        queryKey: importJobKeys.detail(userId, jobId),
        queryFn: () => importExportApi.getImportJobStatus(jobId).then((response) => response.data),
        refetchInterval: (query) => (
            query.state.status !== 'error' && ACTIVE_IMPORT_STATUSES.includes(query.state.data?.status)
                ? 2000
                : false
        ),
    }),
};
