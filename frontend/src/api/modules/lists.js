// API calls owned by G3 Lists (feature-revamp seams).
import api from '../httpClient';

export const listApi = {
    getAll: (params) => api.get('/lists/', { params }),
    add: (data) => api.post('/lists/', data),
    update: (id, data) => api.patch(`/lists/${id}/`, data),
    remove: (id) => api.delete(`/lists/${id}/`),
};
