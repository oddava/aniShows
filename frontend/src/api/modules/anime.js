import api from '../httpClient';

export const animeApi = {
    getAll: (params, signal) => api.get('/anime/', { params, signal }),
    getBySlug: (slug, signal) => api.get(`/anime/${slug}/`, { signal }),
    getTrending: (signal) => api.get('/anime/trending/', { signal }),
    getTopRated: (signal) => api.get('/anime/top_rated/', { signal }),
    getRelated: (slug, signal) => api.get(`/anime/${slug}/related/`, { signal }),
    getRecommendations: (slug, signal) => api.get(`/anime/${slug}/recommendations/`, { signal }),
    getReviews: (slug, signal) => api.get(`/anime/${slug}/reviews/`, { signal }),
    getCharacters: (slug, signal) => api.get(`/anime/${slug}/characters/`, { signal }),
    getStaff: (slug, signal) => api.get(`/anime/${slug}/staff/`, { signal }),
    getWatchEpisodes: (slug, params, signal) => api.get(`/anime/${slug}/watch-episodes/`, { params, signal }),
    getEpisodeRatings: (slug, signal) => api.get(`/anime/${slug}/episode-ratings/`, { signal }),
    setEpisodeRating: (slug, episodeNumber, data) => api.put(`/anime/${slug}/episode-ratings/${episodeNumber}/`, data),
    clearEpisodeRating: (slug, episodeNumber) => api.delete(`/anime/${slug}/episode-ratings/${episodeNumber}/`),
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
