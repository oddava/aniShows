// Query retry policy owned by G2 Browse & discover (smoke finding S-2).

// Client errors that can go away on their own: a timeout and a rate limit.
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);
const MAX_RETRIES = 1;

/**
 * The HTTP status of a failed request, or null for a network error or a
 * non-HTTP failure. Axios puts it on `error.response.status`.
 *
 * @param {unknown} error
 * @returns {number | null}
 */
const httpStatus = (error) => {
    const status = error?.response?.status ?? error?.status;
    return Number.isInteger(status) ? status : null;
};

/**
 * TanStack Query `retry` function: never retry a 4xx (a missing slug, a
 * private profile, a validation error will fail the same way again), except
 * 408 and 429. Network errors and 5xx keep the single retry the app has
 * always had.
 *
 * @param {number} failureCount failures so far (0 on the first failure)
 * @param {unknown} error
 * @returns {boolean}
 */
export function retryUnlessClientError(failureCount, error) {
    const status = httpStatus(error);
    if (status !== null && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)) {
        return false;
    }
    return failureCount < MAX_RETRIES;
}
