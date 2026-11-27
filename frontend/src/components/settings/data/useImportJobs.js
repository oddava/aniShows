import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { importExportApi } from '../../../api/client';
import {
    FINISHED_IMPORT_STATUSES,
    anilistLinkKeys,
    importJobKeys,
    importJobQueries,
} from '../../../api/queries/importJobs';
import { listKeys } from '../../../api/queries/lists';
import { profileKeys, userKeys } from '../../../api/queries/profile';
import { isActiveJob } from './importHelpers';

const EMPTY = [];

/**
 * The signed-in user's import jobs for the Import & export tab.
 *
 * The list is read once; the one running job (there is at most one per user)
 * is then re-read every 2 seconds until it finishes, and its fresh copy
 * replaces the list's. When it finishes, everything an import can change is
 * refreshed: the list, the profile, Home's shelf and the AniList link.
 */
export default function useImportJobs(userId) {
    const queryClient = useQueryClient();

    const listQuery = useQuery({
        ...importJobQueries.list(userId),
        enabled: !!userId,
        staleTime: 0,
        retry: false,
    });
    const listed = listQuery.data ?? EMPTY;
    const runningId = listed.find(isActiveJob)?.id ?? null;

    const runningQuery = useQuery({
        ...importJobQueries.status(userId, runningId),
        enabled: !!userId && runningId !== null,
        staleTime: 0,
        retry: false,
        refetchIntervalInBackground: true,
    });
    const polled = runningId !== null ? runningQuery.data : undefined;

    const jobs = useMemo(
        () => (polled ? listed.map((job) => (job.id === polled.id ? polled : job)) : listed),
        [listed, polled],
    );

    const settled = useRef(new Set());
    useEffect(() => {
        if (!polled || !FINISHED_IMPORT_STATUSES.includes(polled.status)) return;
        if (settled.current.has(polled.id)) return;
        settled.current.add(polled.id);
        queryClient.invalidateQueries({ queryKey: importJobKeys.list(userId) });
        queryClient.invalidateQueries({ queryKey: anilistLinkKeys.forUser(userId) });
        // A failed or cancelled job may still have written some entries.
        queryClient.invalidateQueries({ queryKey: listKeys.all });
        queryClient.invalidateQueries({ queryKey: profileKeys.own });
        queryClient.invalidateQueries({ queryKey: userKeys.watching });
    }, [polled, queryClient, userId]);

    /** A job was queued: re-read the list so it shows up and gets polled. */
    const track = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: importJobKeys.list(userId) });
    }, [queryClient, userId]);

    const cancelMutation = useMutation({
        mutationFn: (jobId) => importExportApi.cancelImportJob(jobId),
        onSettled: () => queryClient.invalidateQueries({ queryKey: importJobKeys.forUser(userId) }),
    });

    return {
        jobs,
        running: jobs.find(isActiveJob) ?? null,
        isLoading: listQuery.isLoading,
        isError: listQuery.isError,
        retry: () => listQuery.refetch(),
        track,
        cancel: cancelMutation,
    };
}
