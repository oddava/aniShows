import api from '../httpClient';

export const authApi = {
    login: (credentials) => api.post('/auth/login/', credentials),
    register: (data) => api.post('/auth/register/', data),
    logout: () => api.post('/auth/logout/'),
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
    verifyEmail: (uid, token) => api.get(`/verify-email/${uid}/${token}/`),
    resendVerification: (email) => api.post('/auth/resend-verification/', { email }),
    changeEmail: (data) => api.post('/auth/change-email/', data),
    confirmEmailChange: (uid, token, newEmail) =>
        api.get(`/confirm-email-change/${uid}/${token}/${newEmail}/`),
    deleteAccount: (data) => api.delete('/auth/delete-account/', { data }),
};
