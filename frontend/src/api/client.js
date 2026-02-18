import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import logger from '../utils/logger';

const API_BASE_URL = '/api/v1';
const TOKEN_REFRESH_THRESHOLD = 5 * 60; // Refresh token if it expires in less than 5 minutes

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// Token refresh state management
let isRefreshing = false;
let refreshPromise = null;
let failedRequestQueue = [];

// Process queued requests after refresh succeeds/fails
const processQueue = (error, token = null) => {
    failedRequestQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedRequestQueue = [];
};

// Check if token needs proactive refresh
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

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Refresh access token with proper locking, queueing, and retry logic
const refreshAccessToken = async (retryCount = 0) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    // If refresh is already in progress, wait for it
    if (isRefreshing) {
        logger.debug('Token refresh already in progress, waiting...');
        return refreshPromise;
    }

    isRefreshing = true;
    refreshPromise = new Promise(async (resolve, reject) => {
        try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                throw new Error('No refresh token available');
            }

            // Check if refresh token itself is expired
            try {
                const decoded = jwtDecode(refreshToken);
                const currentTime = Date.now() / 1000;
                if (decoded.exp < currentTime) {
                    throw new Error('Refresh token expired');
                }
            } catch (decodeError) {
                throw new Error('Invalid refresh token');
            }

            const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
                refresh: refreshToken,
            });

            const { access, refresh } = response.data;
            localStorage.setItem('access_token', access);
            
            // Update refresh token if rotated (when BLACKLIST_AFTER_ROTATION is enabled)
            if (refresh) {
                localStorage.setItem('refresh_token', refresh);
                logger.debug('Refresh token rotated and updated');
            }
            
            logger.debug('Token refresh successful');
            resolve(access);
        } catch (error) {
            // Check if we should retry (network errors only, not 401s)
            const isNetworkError = !error.response && error.request;
            const isServerError = error.response && error.response.status >= 500 && error.response.status < 600;
            
            if ((isNetworkError || isServerError) && retryCount < MAX_RETRIES) {
                logger.warn(`Token refresh failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}), retrying in ${RETRY_DELAY_MS}ms:`, error.message);
                
                isRefreshing = false;
                refreshPromise = null;
                
                await delay(RETRY_DELAY_MS * (retryCount + 1)); // Exponential backoff
                
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
                isServerError
            });
            reject(error);
        } finally {
            if (retryCount === 0 || error?.response?.status === 401) {
                isRefreshing = false;
                refreshPromise = null;
            }
        }
    });

    return refreshPromise;
};

// Request interceptor - add auth token and handle proactive refresh
api.interceptors.request.use(
    async (config) => {
        const token = localStorage.getItem('access_token');
        
        if (token) {
            // Check if token needs proactive refresh
            if (shouldRefreshToken(token) && !config._skipProactiveRefresh) {
                try {
                    const newToken = await refreshAccessToken();
                    config.headers.Authorization = `Bearer ${newToken}`;
                } catch (error) {
                    // If proactive refresh fails, still try with current token
                    // The response interceptor will handle the failure
                    logger.warn('Proactive refresh failed, using existing token:', error.message);
                    config.headers.Authorization = `Bearer ${token}`;
                }
            } else {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh with retry logic and queueing
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Don't retry if already retried or if it's a refresh request itself
        if (error.response?.status === 401 && 
            !originalRequest._retry && 
            !originalRequest.url?.includes('/auth/refresh/') &&
            !originalRequest.url?.includes('/auth/login/')) {
            
            originalRequest._retry = true;

            // If refresh is in progress, queue this request
            if (isRefreshing) {
                logger.debug('Queuing request while token refresh is in progress');
                return new Promise((resolve, reject) => {
                    failedRequestQueue.push({
                        resolve: (token) => {
                            originalRequest.headers.Authorization = `Bearer ${token}`;
                            resolve(api(originalRequest));
                        },
                        reject: (err) => {
                            reject(err);
                        },
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
                
                // Clear tokens only on authentication errors (not network errors)
                if (refreshError.response?.status === 401 || 
                    refreshError.message?.includes('expired') ||
                    refreshError.message?.includes('No refresh token')) {
                    
                    logger.error('Authentication failed, clearing tokens');
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                    
                    // Redirect to login after a short delay to allow cleanup
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

        return Promise.reject(error);
    }
);

export default api;

// API functions
export const animeApi = {
    getAll: (params) => api.get('/anime/', { params }),
    getBySlug: (slug) => api.get(`/anime/${slug}/`),
    getTrending: () => api.get('/anime/trending/'),
    getTopRated: () => api.get('/anime/top_rated/'),
    getRelated: (slug) => api.get(`/anime/${slug}/related/`),
    getReviews: (slug) => api.get(`/anime/${slug}/reviews/`),
};

export const genreApi = {
    getAll: () => api.get('/genres/'),
};

export const studioApi = {
    getAll: () => api.get('/studios/'),
};

export const authApi = {
    login: (credentials) => api.post('/auth/login/', credentials),
    register: (data) => api.post('/auth/register/', data),
    logout: () => api.post('/auth/logout/'),
    getProfile: (full = false) => api.get('/users/me/', { params: { full } }),
    getByUsername: (username) => api.get(`/users/${username}/`),
    getStats: () => api.get('/users/me/stats/'),
    updateProfile: (data) => {
        // Handle FormData (file uploads) - transformRequest removes default headers
        // This lets the browser set the correct multipart/form-data boundary
        const isFormData = data instanceof FormData;
        return api.patch('/users/me/', data, isFormData ? {
            transformRequest: [(data, headers) => {
                delete headers['Content-Type'];
                return data;
            }]
        } : {});
    },
    changePassword: (data) => api.post('/auth/change-password/', data),
    requestPasswordReset: (email) => api.post('/auth/password-reset/', { email }),
    resetPassword: (uid, token, password) => api.post('/auth/password-reset-confirm/', { uid, token, password }),
    verifyEmail: (uid, token) => api.get(`/verify-email/${uid}/${token}/`),
    resendVerification: (email) => api.post('/auth/resend-verification/', { email }),
    changeEmail: (data) => api.post('/auth/change-email/', data),
    confirmEmailChange: (uid, token, newEmail) => api.get(`/confirm-email-change/${uid}/${token}/${newEmail}/`),
    deleteAccount: (data) => api.post('/auth/delete-account/', data),
};

export const favoriteApi = {
    getAll: (params) => api.get('/favorites/', { params }),
    toggle: (animeId) => api.post('/favorites/toggle/', { anime_id: animeId }),
    reorder: (orderedItems) => api.post('/favorites/reorder/', { items: orderedItems }),
};

export const listApi = {
    getAll: (params) => api.get('/lists/', { params }),
    add: (data) => api.post('/lists/', data),
    update: (id, data) => api.patch(`/lists/${id}/`, data),
    remove: (id) => api.delete(`/lists/${id}/`),
};

export const reviewApi = {
    getAll: (params) => api.get('/reviews/', { params }),
    getStats: (animeSlug) => api.get(`/reviews/stats/`, { params: { anime: animeSlug } }),
    create: (data) => api.post('/reviews/', data),
    update: (id, data) => api.patch(`/reviews/${id}/`, data),
    delete: (id) => api.delete(`/reviews/${id}/`),
    vote: (id, isHelpful = true) => api.post(`/reviews/${id}/vote/`, { is_helpful: isHelpful }),
    // Comments
    getComments: (reviewId, page = 1, pageSize = 10) => 
        api.get(`/reviews/${reviewId}/comments/`, { params: { page, page_size: pageSize } }),
    addComment: (reviewId, text) => 
        api.post(`/reviews/${reviewId}/add_comment/`, { text }),
    updateComment: (reviewId, commentId, text) => 
        api.patch(`/reviews/${reviewId}/comments/${commentId}/`, { text }),
    deleteComment: (reviewId, commentId) => 
        api.delete(`/reviews/${reviewId}/comments/${commentId}/delete/`),
};

export const recommendationsApi = {
    getAll: (limit = 12) => api.get('/recommendations/', { params: { limit } }),
    refresh: () => api.post('/recommendations/refresh/'),
    dismiss: (animeId) => api.post(`/recommendations/${animeId}/dismiss/`),
};

export const importExportApi = {
    // Import
    importMAL: (username) => api.post('/import/mal/', { username }),
    importMALXML: (file) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/import/mal/xml/', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },
    importAniList: (username, accessToken = null) => api.post('/import/anilist/', {
        username,
        access_token: accessToken
    }),
    getImportJobs: () => api.get('/import/jobs/'),
    getImportJobStatus: (jobId) => api.get(`/import/jobs/${jobId}/`),
    cancelImportJob: (jobId) => api.post(`/import/jobs/${jobId}/cancel/`),

    // Export
    exportData: (format = 'json') => api.get('/export/', {
        params: { type: format },
        responseType: 'blob'
    }),
    exportDataJSON: () => api.get('/export/json/'),
};

export const followApi = {
    toggle: (username) => api.post('/follows/toggle/', { username }),
    getFollowers: (username, params) => api.get(`/follows/followers/${username}/`, { params }),
    getFollowing: (username, params) => api.get(`/follows/following/${username}/`, { params }),
    check: (username) => api.get(`/follows/check/${username}/`),
    getFriendsWatching: (animeId) => api.get('/follows/friends/watching/', { params: { anime_id: animeId } }),
};

export const notificationApi = {
    getAll: (params) => api.get('/notifications/', { params }),
    getUnreadCount: () => api.get('/notifications/unread_count/'),
    markAsRead: (id) => api.patch(`/notifications/${id}/mark_read/`),
    markAllAsRead: () => api.post('/notifications/mark_all_read/'),
    delete: (id) => api.delete(`/notifications/${id}/`),
    getPreferences: () => api.get('/notifications/preferences/'),
    updatePreferences: (data) => api.put('/notifications/preferences/', data),
    subscribe: (data) => api.post('/notifications/subscribe/', data),
    unsubscribe: (endpoint) => api.delete('/notifications/subscribe/', { data: { endpoint } }),
    getSubscriptions: () => api.get('/notifications/subscribe/'),
};
