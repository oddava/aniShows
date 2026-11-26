import api from '../httpClient';

export const authApi = {
    login: (credentials) => api.post('/auth/login/', credentials),
    register: (data) => api.post('/auth/register/', data),
    // Lives under the refresh cookie's path so the browser sends the cookie.
    logout: () => api.post('/auth/refresh/logout/', null, { _skipProactiveRefresh: true }),
    getWsTicket: () => api.post('/auth/ws-ticket/'),
    getProfile: (full = false) => api.get('/users/me/', { params: { full } }),
    getByUsername: (username) => api.get(`/users/${username}/`),
    /** How close the signed-in viewer's taste is to `username`'s (0-100 plus shared shows). */
    getCompatibility: (username) => api.get(`/users/${encodeURIComponent(username)}/compatibility/`),
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
    // Body, not path: the token stays out of access logs (A14).
    verifyEmail: (uid, token) => api.post('/verify-email/', { uid, token }),
    resendVerification: (email) => api.post('/auth/resend-verification/', { email }),
    changeEmail: (data) => api.post('/auth/change-email/', data),
    // `newEmail` only for links sent before pending_email (one release).
    confirmEmailChange: (uid, token, newEmail) =>
        api.post('/auth/confirm-email-change/', newEmail ? { uid, token, new_email: newEmail } : { uid, token }),
    resendEmailChange: () => api.post('/auth/resend-email-change/'),
    cancelEmailChange: () => api.post('/auth/cancel-email-change/'),
    // Under the refresh cookie's path, like logout: the cookie identifies this device.
    getSessions: () => api.get('/auth/refresh/sessions/', { _skipProactiveRefresh: true }),
    revokeOtherSessions: () =>
        api.post('/auth/refresh/sessions/revoke-others/', null, { _skipProactiveRefresh: true }),
    googleLogin: (code, callbackUrl) =>
        api.post('/auth/google/', { code, callback_url: callbackUrl }),
    deleteAccount: (data) => api.delete('/auth/delete-account/', { data }),
};
