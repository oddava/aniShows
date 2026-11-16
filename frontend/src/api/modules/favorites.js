// API calls owned by G5 Community (feature-revamp seams).
import api from '../httpClient';

export const favoriteApi = {
    getAll: (params) => api.get('/favorites/', { params }),
    toggle: (animeId) => api.post('/favorites/toggle/', { anime_id: animeId }),
    /** Saves the full order: `ids` are favorite ids, first = shown first. */
    reorder: (ids) => api.post('/favorites/reorder/', { ids }),
};

export const characterFavoriteApi = {
    getAll: (params) => api.get('/character-favorites/', { params }),
    toggle: (characterId) => api.post('/character-favorites/toggle/', { character_id: characterId }),
};

export const staffFavoriteApi = {
    getAll: (params) => api.get('/staff-favorites/', { params }),
    toggle: (staffId) => api.post('/staff-favorites/toggle/', { staff_id: staffId }),
};
