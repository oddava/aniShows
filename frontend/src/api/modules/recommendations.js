// API calls owned by G2 Browse & discover (feature-revamp seams).
import api from '../httpClient';

export const recommendationsApi = {
    getAll: (limit = 12) => api.get('/recommendations/', { params: { limit } }),
    refresh: () => api.post('/recommendations/refresh/'),
    dismiss: (animeId) => api.post(`/recommendations/${animeId}/dismiss/`),
};
