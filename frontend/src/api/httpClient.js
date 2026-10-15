import axios from 'axios';
import { jwtDecode } from 'jwt-decode';

import logger from '../utils/logger';

const API_BASE_URL = '/api/v1';
const TOKEN_REFRESH_THRESHOLD = 5 * 60;
const MAX_REFRESH_RETRIES = 3;
const REFRESH_RETRY_DELAY_MS = 1000;
export const MAINTENANCE_MODE_EVENT = 'app:maintenance-mode';
export const AUTH_EXPIRED_EVENT = 'app:auth-expired';

// Not a secret: only remembers that a refresh cookie was issued, so anonymous
// visitors don't fire a refresh request on every page load. The refresh token
// itself lives in an httpOnly cookie that JavaScript cannot read.
export const SESSION_HINT_KEY = 'auth_session';

// The backend requires this header on cookie-authenticated auth endpoints.
// Cross-origin pages cannot send it without passing a CORS preflight.
const CSRF_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        ...CSRF_HEADERS,
    },
    withCredentials: true,
});

// The access token is kept in memory only and never persisted.
let accessToken = null;
let refreshPromise = null;

const readSessionHint = () => {
    try {
        return localStorage.getItem(SESSION_HINT_KEY) === '1';
    } catch {
        return false;
    }
};

const writeSessionHint = (active) => {
    try {
        if (active) {
            localStorage.setItem(SESSION_HINT_KEY, '1');
        } else {
            localStorage.removeItem(SESSION_HINT_KEY);
        }
    } catch {
        // Storage can be unavailable (private mode); the hint is only an optimisation.
    }
};

// Tokens persisted by earlier builds must not linger in storage.
try {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
} catch {
    // ignore
}

export const getAccessToken = () => accessToken;

export const hasSession = () => Boolean(accessToken) || readSessionHint();

export const setAccessToken = (token) => {
    accessToken = token;
    writeSessionHint(true);
};

export const clearSession = () => {
    accessToken = null;
    writeSessionHint(false);
};

class NoSessionError extends Error {
    constructor() {
        super('No session');
        this.name = 'NoSessionError';
    }
}

/** True when the error means the session is gone (not a transient failure). */
export const isAuthFailureError = (error) =>
    error instanceof NoSessionError ||
    error?.response?.status === 401 ||
    error?.response?.status === 403;

const emitMaintenanceMode = (enabled, payload = {}) => {
    if (typeof window === 'undefined') return;

    if (enabled) {
        sessionStorage.setItem('app_maintenance_mode', 'true');
    } else {
        sessionStorage.removeItem('app_maintenance_mode');
    }

    window.dispatchEvent(
        new CustomEvent(MAINTENANCE_MODE_EVENT, {
            detail: {
                enabled,
                ...payload,
            },
        }),
    );
};

const shouldRefreshToken = (token) => {
    try {
        const decoded = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        const timeUntilExpiry = decoded.exp - currentTime;
        return timeUntilExpiry < TOKEN_REFRESH_THRESHOLD && timeUntilExpiry > 0;
    } catch {
        return false;
    }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isMaintenanceResponse = (error) => {
    if (error.response?.status !== 503) return false;

    const detail = String(error.response?.data?.detail || '').toLowerCase();
    const maintenanceModeFlag = error.response?.data?.maintenance_mode === true;
    const hasMaintenanceText = detail.includes('maintenance');
    const retryAfter = error.response?.headers?.['retry-after'];

    // Treat as global maintenance only when the backend explicitly signals it.
    return maintenanceModeFlag || (hasMaintenanceText && Boolean(retryAfter));
};

const requestNewAccessToken = async () => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, null, {
                withCredentials: true,
                headers: CSRF_HEADERS,
            });
            return response.data.access;
        } catch (error) {
            const retryable = !error.response || error.response.status >= 500;
            if (!retryable || attempt >= MAX_REFRESH_RETRIES) throw error;

            logger.warn(
                `Token refresh failed (attempt ${attempt + 1}/${MAX_REFRESH_RETRIES + 1}), retrying:`,
                error.message,
            );
            await delay(REFRESH_RETRY_DELAY_MS * (attempt + 1));
        }
    }
};

// Refresh rotates the cookie and blacklists the old token, so two tabs must
// not refresh at the same moment. Web Locks serialise them across tabs.
const withCrossTabLock = (fn) => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks?.request ? locks.request('anishows-token-refresh', fn) : fn();
};

/**
 * Get a new access token using the httpOnly refresh cookie.
 *
 * Concurrent callers share one in-flight request. On an auth failure the
 * session is cleared and AUTH_EXPIRED_EVENT is dispatched.
 */
export const refreshAccessToken = () => {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        if (!readSessionHint()) throw new NoSessionError();

        try {
            const token = await withCrossTabLock(requestNewAccessToken);
            setAccessToken(token);
            logger.debug('Token refresh successful');
            return token;
        } catch (error) {
            if (isAuthFailureError(error)) {
                logger.info('Session expired, signing out');
                clearSession();
                window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
            } else {
                logger.error('Token refresh failed:', error.message);
            }
            throw error;
        }
    })().finally(() => {
        refreshPromise = null;
    });

    return refreshPromise;
};

const NO_REFRESH_ON_401 = ['/auth/refresh/', '/auth/login/', '/auth/google/'];

api.interceptors.request.use(
    async (config) => {
        let token = accessToken;

        if (token && shouldRefreshToken(token) && !config._skipProactiveRefresh) {
            try {
                token = await refreshAccessToken();
            } catch (error) {
                logger.warn('Proactive refresh failed:', error.message);
                token = accessToken;
            }
        }

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => Promise.reject(error),
);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (
            error.response?.status === 401 &&
            originalRequest &&
            !originalRequest._retry &&
            !NO_REFRESH_ON_401.some((path) => originalRequest.url?.includes(path)) &&
            hasSession()
        ) {
            originalRequest._retry = true;

            try {
                const token = await refreshAccessToken();
                originalRequest.headers.Authorization = `Bearer ${token}`;
                return api(originalRequest);
            } catch (refreshError) {
                // On an auth failure the caller sees the original 401; the
                // AUTH_EXPIRED_EVENT listener signs the user out.
                return Promise.reject(isAuthFailureError(refreshError) ? error : refreshError);
            }
        }

        if (isMaintenanceResponse(error)) {
            const detail = error.response?.data?.detail || 'The service is temporarily unavailable.';
            emitMaintenanceMode(true, {
                message: detail,
                retryAfter: error.response?.headers?.['retry-after'] || null,
            });
        }

        return Promise.reject(error);
    },
);

export default api;
