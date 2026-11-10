import { useEffect, useRef } from 'react';
import { hashKey } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import logger from '../utils/logger';

/**
 * The query's error, but only if it happened while this component was looking
 * at this key. An error left in the cache by an earlier visit (or by the same
 * page/tab a while ago) is ignored: the query refetches on mount anyway, and
 * the useEffect fetches this replaces never showed a previous visit's failure.
 */
export function useFreshError(query, queryKey) {
    const hash = hashKey(queryKey);
    const since = useRef(null);
    if (since.current?.hash !== hash) {
        since.current = { hash, at: Date.now() };
    }
    return query.error && query.errorUpdatedAt >= since.current.at ? query.error : null;
}

/**
 * Logs (and optionally toasts) once per failed fetch, like the catch blocks of
 * the old fetch functions. Pass the error from useFreshError and the query's
 * `errorUpdatedAt`. `toastMessage` may be a string or `(error) => string`;
 * falsy means no toast. `skip` suppresses the report for this error.
 */
export function useReportError(error, errorUpdatedAt, { log, toastMessage, skip = false } = {}) {
    const reported = useRef(null);

    useEffect(() => {
        if (!error || skip || reported.current === errorUpdatedAt) return;
        reported.current = errorUpdatedAt;
        if (log) logger.error(log, error);
        const message = typeof toastMessage === 'function' ? toastMessage(error) : toastMessage;
        if (message) toast.error(message);
    }, [error, errorUpdatedAt, log, toastMessage, skip]);
}
