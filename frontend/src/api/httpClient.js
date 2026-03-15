import axios from 'axios';
import { jwtDecode } from 'jwt-decode';

import logger from '../utils/logger';

const API_BASE_URL = '/api/v1';
const TOKEN_REFRESH_THRESHOLD = 5 * 60;
const TOKEN_EXPIRY_LEEWAY_SECONDS = 30;
export const MAINTENANCE_MODE_EVENT = 'app:maintenance-mode';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

let isRefreshing = false;
let refreshPromise = null;
let failedRequestQueue = [];

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

const processQueue = (error, token = null) => {
    failedRequestQueue.forEach((pendingRequest) => {
        if (error) {
            pendingRequest.reject(error);
            return;
        }
        pendingRequest.resolve(token);
    });
    failedRequestQueue = [];
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

export const refreshAccessToken = async (retryCount = 0) => {
    const maxRetries = 3;
    const retryDelayMs = 1000;

    if (isRefreshing) {
        logger.debug('Token refresh already in progress, waiting...');
        return refreshPromise;
    }

    isRefreshing = true;
    refreshPromise = new Promise(async (resolve, reject) => {
        let caughtError = null;
        try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                throw new Error('No refresh token available');
            }

            let decodedRefreshToken;
            try {
                decodedRefreshToken = jwtDecode(refreshToken);
            } catch {
                throw new Error('Invalid refresh token');
            }

            const currentTime = Date.now() / 1000;
            if (decodedRefreshToken.exp <= currentTime + TOKEN_EXPIRY_LEEWAY_SECONDS) {
                throw new Error('Refresh token expired');
            }

            const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
                refresh: refreshToken,
            });

            const { access, refresh } = response.data;
            localStorage.setItem('access_token', access);

            if (refresh) {
                localStorage.setItem('refresh_token', refresh);
                logger.debug('Refresh token rotated and updated');
            }

            logger.debug('Token refresh successful');
            resolve(access);
        } catch (error) {
            caughtError = error;
            const isNetworkError = !error.response && error.request;
            const isServerError = error.response && error.response.status >= 500 && error.response.status < 600;

            if ((isNetworkError || isServerError) && retryCount < maxRetries) {
                logger.warn(
                    `Token refresh failed (attempt ${retryCount + 1}/${maxRetries + 1}), retrying in ${retryDelayMs}ms:`,
                    error.message,
                );

                isRefreshing = false;
                refreshPromise = null;

                await delay(retryDelayMs * (retryCount + 1));

                try {
                    const result = await refreshAccessToken(retryCount + 1);
                    resolve(result);
                    return;
                } catch (retryError) {
                    reject(retryError);
                    return;
                }
            }

            logger.error('Token refresh failed:', error.message, {
                retryCount,
                status: error.response?.status,
                isNetworkError,
                isServerError,
            });
            reject(error);
        } finally {
            if (retryCount === 0 || caughtError?.response?.status === 401) {
                isRefreshing = false;
                refreshPromise = null;
            }
        }
    });

    return refreshPromise;
};

api.interceptors.request.use(
    async (config) => {
        const token = localStorage.getItem('access_token');

        if (token) {
            if (shouldRefreshToken(token) && !config._skipProactiveRefresh) {
                try {
                    const newToken = await refreshAccessToken();
                    config.headers.Authorization = `Bearer ${newToken}`;
                } catch (error) {
                    logger.warn('Proactive refresh failed, using existing token:', error.message);
                    config.headers.Authorization = `Bearer ${token}`;
                }
            } else {
                config.headers.Authorization = `Bearer ${token}`;
            }
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
            !originalRequest._retry &&
            !originalRequest.url?.includes('/auth/refresh/') &&
            !originalRequest.url?.includes('/auth/login/')
        ) {
            originalRequest._retry = true;

            if (isRefreshing) {
                logger.debug('Queuing request while token refresh is in progress');
                return new Promise((resolve, reject) => {
                    failedRequestQueue.push({
                        resolve: (token) => {
                            originalRequest.headers.Authorization = `Bearer ${token}`;
                            resolve(api(originalRequest));
                        },
                        reject,
                    });
                });
            }

            try {
                const newToken = await refreshAccessToken();
                processQueue(null, newToken);
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return api(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError, null);

                if (
                    refreshError.response?.status === 401 ||
                    refreshError.message?.includes('expired') ||
                    refreshError.message?.includes('No refresh token')
                ) {
                    logger.error('Authentication failed, clearing tokens');
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');

                    if (!window.location.pathname.includes('/login')) {
                        setTimeout(() => {
                            if (!localStorage.getItem('access_token')) {
                                window.location.href = '/login';
                            }
                        }, 100);
                    }
                }

                return Promise.reject(refreshError);
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
