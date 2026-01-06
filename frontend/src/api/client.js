import axios from 'axios';

const API_BASE_URL = '/api/v1';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// Request interceptor - add auth token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const refreshToken = localStorage.getItem('refresh_token');
                if (refreshToken) {
                    const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
                        refresh: refreshToken,
                    });

                    const { access } = response.data;
                    localStorage.setItem('access_token', access);

                    originalRequest.headers.Authorization = `Bearer ${access}`;
                    return api(originalRequest);
                }
            } catch (refreshError) {
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                window.location.href = '/login';
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
    verifyEmail: (data) => api.post('/auth/verify-email/', data),
    resendVerification: (data) => api.post('/auth/resend-verification/', data),
    resetPassword: (data) => api.post('/auth/password-reset/', data),
    resetPasswordConfirm: (data) => api.post('/auth/password-reset-confirm/', data),
    getProfile: () => api.get('/users/me/'),
    updateProfile: (data) => {
        const isFormData = data instanceof FormData;
        return api.patch('/users/me/', data, {
            headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {},
        });
    },
    googleLogin: (code, callback_url) => api.post('/auth/google/', { code, callback_url }),
    changePassword: (data) => api.post('/auth/change-password/', data),
    deleteAccount: (data) => api.delete('/auth/delete-account/', { data }),
    changeEmail: (data) => api.post('/auth/change-email/', data),
    confirmEmailChange: (data) => api.post('/auth/confirm-email-change/', data),
    getByUsername: (username) => api.get(`/users/${username}/`),
};

export const favoriteApi = {
    getAll: (params) => api.get('/favorites/', { params }),
    toggle: (animeId) => api.post('/favorites/toggle/', { anime_id: animeId }),
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
};
