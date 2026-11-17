// API calls owned by G4 Notifications (feature-revamp seams).
import api from '../httpClient';

export const notificationApi = {
    /** Feed. Params: page, page_size, is_read ('true'|'false'), category, type (comma-separated). */
    getAll: (params) => api.get('/notifications/', { params }),
    getUnreadCount: () => api.get('/notifications/unread_count/'),
    markAsRead: (id) => api.patch(`/notifications/${id}/mark_read/`),
    markAllAsRead: () => api.post('/notifications/mark_all_read/'),
    delete: (id) => api.delete(`/notifications/${id}/`),

    /** `{preferences, schema}`. */
    getPreferences: () => api.get('/notifications/preferences/'),
    /** Partial nested update, e.g. `{replies: {push: false}}`; responds with the full `{preferences, schema}`. */
    updatePreferences: (data) => api.patch('/notifications/preferences/', data),
    /** Full replace (kept for older callers). */
    replacePreferences: (data) => api.put('/notifications/preferences/', data),

    /** `{enabled, public_key}`; `enabled` is false when the server has no VAPID keys. */
    getPushConfig: () => api.get('/notifications/push/config/'),
    subscribe: (data) => api.post('/notifications/subscribe/', data),
    unsubscribe: (endpoint) => api.delete('/notifications/unsubscribe/', { data: { endpoint } }),
    /** This user's active devices: `[{id, device_type, device_info, created_at, last_used}]`. */
    getSubscriptions: () => api.get('/notifications/subscribe/'),
    deleteSubscription: (id) => api.delete(`/notifications/subscriptions/${id}/`),

    /** One-click unsubscribe from episode emails (no auth; the token comes from the email link). */
    emailUnsubscribe: (token) => api.post('/notifications/email-unsubscribe/', { token }),
};
