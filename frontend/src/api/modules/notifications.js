// API calls owned by G4 Notifications (feature-revamp seams).
import api from '../httpClient';

export const notificationApi = {
    getAll: (params) => api.get('/notifications/', { params }),
    getUnreadCount: () => api.get('/notifications/unread_count/'),
    markAsRead: (id) => api.patch(`/notifications/${id}/mark_read/`),
    markAllAsRead: () => api.post('/notifications/mark_all_read/'),
    delete: (id) => api.delete(`/notifications/${id}/`),
    getPreferences: () => api.get('/notifications/preferences/'),
    updatePreferences: (data) => api.put('/notifications/preferences/', data),
    subscribe: (data) => api.post('/notifications/subscribe/', data),
    unsubscribe: (endpoint) => api.delete('/notifications/unsubscribe/', { data: { endpoint } }),
    getSubscriptions: () => api.get('/notifications/subscribe/'),
};
