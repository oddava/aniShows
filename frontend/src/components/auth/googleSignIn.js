import { safeReturnPath } from './returnTo';

const GOOGLE_OAUTH_STATE_KEY = 'google_oauth_state';
const GOOGLE_RETURN_TO_KEY = 'google_oauth_return_to';

export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

/**
 * Send the browser to Google's consent screen (authorization-code flow).
 *
 * `returnTo` is where the callback lands after signing in (same-origin path
 * only). `prompt: 'select_account'` makes Google ask again, which is how a
 * passwordless account confirms it's you before a sensitive change.
 */
export function startGoogleSignIn({ returnTo, prompt } = {}) {
    const state = window.crypto.randomUUID();
    sessionStorage.setItem(GOOGLE_OAUTH_STATE_KEY, state);
    if (returnTo) {
        sessionStorage.setItem(GOOGLE_RETURN_TO_KEY, safeReturnPath(returnTo));
    } else {
        sessionStorage.removeItem(GOOGLE_RETURN_TO_KEY);
    }

    const params = new URLSearchParams({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
        redirect_uri: `${window.location.origin}${GOOGLE_CALLBACK_PATH}`,
        response_type: 'code',
        scope: 'openid profile email',
        access_type: 'online',
        include_granted_scopes: 'true',
        state,
    });
    if (prompt) params.set('prompt', prompt);

    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

/**
 * Check the callback's `state` against the one this tab stored, once.
 * Returns `{ valid, returnTo }`; the stored values are removed either way.
 */
export function consumeGoogleSignInState(state) {
    const expected = sessionStorage.getItem(GOOGLE_OAUTH_STATE_KEY);
    const returnTo = sessionStorage.getItem(GOOGLE_RETURN_TO_KEY);
    sessionStorage.removeItem(GOOGLE_OAUTH_STATE_KEY);
    sessionStorage.removeItem(GOOGLE_RETURN_TO_KEY);
    return {
        valid: Boolean(state && expected && state === expected),
        returnTo: safeReturnPath(returnTo, '/browse'),
    };
}
