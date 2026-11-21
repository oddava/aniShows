import { getApiErrorMessage } from '../../api/errors';

export const WRONG_CREDENTIALS_MESSAGE = 'Wrong username or password.';

// SimpleJWT / DRF wording for "these credentials don't match an account".
const CREDENTIALS_CODES = new Set(['no_active_account', 'authentication_failed']);
const CREDENTIALS_TEXT = /no active account|given credentials|invalid credentials|provided credentials|invalid username or password/i;

const waitText = (retryAfter) => {
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return 'in a minute';
    if (seconds < 60) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.ceil(seconds / 60);
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
};

/**
 * What to tell someone whose sign-in failed: `{ message, offerReset }`.
 * Raw backend text such as "No active account found with the given
 * credentials" becomes one plain line; `offerReset` adds a reset link.
 */
export function describeLoginError(error) {
    const response = error?.response;
    const data = response?.data ?? {};
    const detail = typeof data.detail === 'string' ? data.detail : '';

    if (response?.status === 429 || data.code === 'throttled') {
        return {
            message: `Too many sign-in attempts. Try again ${waitText(response?.headers?.['retry-after'])}.`,
            offerReset: true,
        };
    }

    if (response?.status === 401 || CREDENTIALS_CODES.has(data.code) || CREDENTIALS_TEXT.test(detail)) {
        return { message: WRONG_CREDENTIALS_MESSAGE, offerReset: true };
    }

    if (error && !response) {
        return {
            message: "Can't reach AniShows right now. Check your connection and try again.",
            offerReset: false,
        };
    }

    return { message: getApiErrorMessage(error, "Sign-in didn't work. Please try again."), offerReset: false };
}
