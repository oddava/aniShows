import axios from 'axios';
import { jwtDecode } from 'jwt-decode';

const API_BASE_URL = '/api/v1';
const TOKEN_REFRESH_THRESHOLD = 5 * 60; // Refresh token if it expires in less than 5 minutes

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

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

// Refresh token proactively
let isRefreshing = false;
let refreshPromise = null;

const refreshAccessToken = async () => {
    if (isRefreshing) {
        return refreshPromise;
    }

    isRefreshing = true;
    refreshPromise = new Promise(async (resolve, reject) => {
        try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                reject(new Error('No refresh token available'));
                return;
            }

            const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
                refresh: refreshToken,
            });

            const { access } = response.data;
            localStorage.setItem('access_token', access);
            resolve(access);
        } catch (error) {
            console.error('Proactive token refresh failed:', error);
            reject(error);
        } finally {
            isRefreshing = false;
            refreshPromise = null;
        }
    });

    return refreshPromise;
};

// Request interceptor - add auth token and proactive refresh
api.interceptors.request.use(
    async (config) => {
        const token = localStorage.getItem('access_token');
        
        if (token) {
            // Check if token needs proactive refresh (but don't block the request)
            if (shouldRefreshToken(token) && !config._skipProactiveRefresh) {
                try {
                    const newToken = await refreshAccessToken();
                    config.headers.Authorization = `Bearer ${newToken}`;
                } catch (error) {
                    // If proactive refresh fails, still try with current token
                    console.warn('Proactive refresh failed, using current token');
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

// Response interceptor - handle token refresh with retry logic
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Don't retry if already retried or if it's a refresh request itself
        if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/refresh/')) {
            originalRequest._retry = true;

            try {
                // Use the proactive refresh function
                const newToken = await refreshAccessToken();
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return api(originalRequest);
            } catch (refreshError) {
                console.error('Token refresh failed after 401:', refreshError);
                // Only clear tokens and redirect if refresh truly fails
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                
                // Don't redirect immediately - let the app handle it gracefully
                // This prevents flash redirects on transient errors
                if (!window.location.pathname.includes('/login')) {
                    setTimeout(() => {
                        if (!localStorage.getItem('access_token')) {
                            window.location.href = '/login';
                        }
                    }, 100);
                }
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
    getStats: () => api.get('/users/me/stats/'),
    updateProfile: (data) => api.patch('/users/me/', data),
    changePassword: (data) => api.post('/auth/change-password/', data),
    requestPasswordReset: (email) => api.post('/auth/password-reset/', { email }),
    resetPassword: (uid, token, password) => api.post('/auth/password-reset-confirm/', { uid, token, password }),
    verifyEmail: (uid, token) => api.get(`/verify-email/${uid}/${token}/`),
    resendVerification: () => api.post('/auth/resend-verification/'),
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
