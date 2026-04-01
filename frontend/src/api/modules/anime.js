import api from '../httpClient';

export const animeApi = {
    getAll: (params, signal) => api.get('/anime/', { params, signal }),
    getBySlug: (slug, signal) => api.get(`/anime/${slug}/`, { signal }),
    getTrending: (signal) => api.get('/anime/trending/', { signal }),
    getTopRated: (signal) => api.get('/anime/top_rated/', { signal }),
    getRelated: (slug, signal) => api.get(`/anime/${slug}/related/`, { signal }),
    getReviews: (slug, signal) => api.get(`/anime/${slug}/reviews/`, { signal }),
    getCharacters: (slug, signal) => api.get(`/anime/${slug}/characters/`, { signal }),
    getStaff: (slug, signal) => api.get(`/anime/${slug}/staff/`, { signal }),
    fetchFranchise: (anilistId, sourceSlug) => api.post('/anime/franchise/fetch/', {
        anilist_id: anilistId,
        source_slug: sourceSlug,
    }),
};

export const genreApi = {
    getAll: () => api.get('/genres/'),
};

export const studioApi = {
    getAll: () => api.get('/studios/'),
};

export const staffApi = {
    getById: (id, signal) => api.get(`/staff/${id}/`, { signal }),
};

export const characterApi = {
    getById: (id, signal) => api.get(`/characters/${id}/`, { signal }),
};
