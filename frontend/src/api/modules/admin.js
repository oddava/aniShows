import api from '../httpClient';

export const adminBadgeApi = {
    getAll: (params) => api.get('/admin/badges/', { params }),
    getById: (id) => api.get(`/admin/badges/${id}/`),
    create: (data) => api.post('/admin/badges/', data, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    }),
    update: (id, data) => api.patch(`/admin/badges/${id}/`, data, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    }),
    delete: (id) => api.delete(`/admin/badges/${id}/`),
    grant: (id, userIds, reason) =>
        api.post(`/admin/badges/${id}/grant/`, { user_ids: userIds, reason }),
    revoke: (id, userIds) => api.post(`/admin/badges/${id}/revoke/`, { user_ids: userIds }),
    getHolders: (id, params) => api.get(`/admin/badges/${id}/holders/`, { params }),
};
