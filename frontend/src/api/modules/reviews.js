// API calls owned by G5 Community (feature-revamp seams).
import api from '../httpClient';

export const reviewApi = {
    getAll: (params) => api.get('/reviews/', { params }),
    getStats: (animeSlug) => api.get('/reviews/stats/', { params: { anime: animeSlug } }),
    create: (data) => api.post('/reviews/', data),
    update: (id, data) => api.patch(`/reviews/${id}/`, data),
    delete: (id) => api.delete(`/reviews/${id}/`),
    vote: (id, voteType) => api.post(`/reviews/${id}/votes/`, { vote_type: voteType }),
    react: (id, reactionType) => api.post(`/reviews/${id}/reactions/`, { reaction_type: reactionType }),
};
