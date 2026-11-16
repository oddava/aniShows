// API calls owned by G3 Lists (feature-revamp seams).
import api from '../httpClient';

export const listApi = {
    /** Paged list: `{ username, status, q, ordering, page, page_size }`. */
    getAll: (params) => api.get('/lists/', { params }),
    /** Counts, totals, score histogram and top genres in one request: `{ username }`. */
    summary: (params) => api.get('/lists/summary/', { params }),
    /** POST is an upsert: 201 when created, 200 when the entry already existed. */
    add: (data) => api.post('/lists/', data),
    update: (id, data) => api.patch(`/lists/${id}/`, data),
    remove: (id) => api.delete(`/lists/${id}/`),
};
