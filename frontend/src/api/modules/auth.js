import api from '../httpClient';

export const authApi = {
    login: (credentials) => api.post('/auth/login/', credentials),
    register: (data) => api.post('/auth/register/', data),
    // Lives under the refresh cookie's path so the browser sends the cookie.
    logout: () => api.post('/auth/refresh/logout/', null, { _skipProactiveRefresh: true }),
    getWsTicket: () => api.post('/auth/ws-ticket/'),
    getProfile: (full = false) => api.get('/users/me/', { params: { full } }),
    getByUsername: (username) => api.get(`/users/${username}/`),
    getStats: () => api.get('/users/me/stats/'),
    updateProfile: (data) => {
        const isFormData = data instanceof FormData;
        return api.patch('/users/me/', data, isFormData ? {
            transformRequest: [(payload, headers) => {
                delete headers['Content-Type'];
                return payload;
            }],
        } : {});
    },
    changePassword: (data) => api.post('/auth/change-password/', data),
    requestPasswordReset: (email) => api.post('/auth/password-reset/', { email }),
    resetPassword: (uid, token, password) =>
        api.post('/auth/password-reset-confirm/', { uid, token, password }),
    // POST keeps the single-use token out of URL access logs.
    verifyEmail: (uid, token) => api.post('/auth/verify-email/', { uid, token }),
    resendVerification: (email) => api.post('/auth/resend-verification/', { email }),
    changeEmail: (data) => api.post('/auth/change-email/', data),
    confirmEmailChange: (uid, token, newEmail) =>
        api.post('/auth/confirm-email-change/', { uid, token, new_email: newEmail }),
    googleLogin: (code, callbackUrl) =>
        api.post('/auth/google/', { code, callback_url: callbackUrl }),
    deleteAccount: (data) => api.delete('/auth/delete-account/', { data }),
};
