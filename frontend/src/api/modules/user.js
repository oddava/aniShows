import api from '../httpClient';

export const favoriteApi = {
    getAll: (params) => api.get('/favorites/', { params }),
    toggle: (animeId) => api.post('/favorites/toggle/', { anime_id: animeId }),
    reorder: (orderedItems) => api.post('/favorites/reorder/', { items: orderedItems }),
};

export const characterFavoriteApi = {
    getAll: (params) => api.get('/character-favorites/', { params }),
    toggle: (characterId) => api.post('/character-favorites/toggle/', { character_id: characterId }),
};

export const staffFavoriteApi = {
    getAll: (params) => api.get('/staff-favorites/', { params }),
    toggle: (staffId) => api.post('/staff-favorites/toggle/', { staff_id: staffId }),
};

export const listApi = {
    getAll: (params) => api.get('/lists/', { params }),
    add: (data) => api.post('/lists/', data),
    update: (id, data) => api.patch(`/lists/${id}/`, data),
    remove: (id) => api.delete(`/lists/${id}/`),
};

export const activityApi = {
    getFeed: (params) => api.get('/activity/', { params }),
    getHeatmap: (params) => api.get('/activity/heatmap/', { params }),
};

export const reviewApi = {
    getAll: (params) => api.get('/reviews/', { params }),
    getStats: (animeSlug) => api.get('/reviews/stats/', { params: { anime: animeSlug } }),
    create: (data) => api.post('/reviews/', data),
    update: (id, data) => api.patch(`/reviews/${id}/`, data),
    delete: (id) => api.delete(`/reviews/${id}/`),
    vote: (id, voteType) => api.post(`/reviews/${id}/votes/`, { vote_type: voteType }),
    react: (id, reactionType) => api.post(`/reviews/${id}/reactions/`, { reaction_type: reactionType }),
};

export const recommendationsApi = {
    getAll: (limit = 12) => api.get('/recommendations/', { params: { limit } }),
    refresh: () => api.post('/recommendations/refresh/'),
    dismiss: (animeId) => api.post(`/recommendations/${animeId}/dismiss/`),
};

export const importExportApi = {
    importMAL: (username) => api.post('/import/mal/', { username }),
    importMALXML: (file) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/import/mal/xml/', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    importAniList: (username, accessToken = null) => api.post('/import/anilist/', {
        username,
        access_token: accessToken,
    }),
    getImportJobs: () => api.get('/import/jobs/'),
    getImportJobStatus: (jobId) => api.get(`/import/jobs/${jobId}/`),
    cancelImportJob: (jobId) => api.post(`/import/jobs/${jobId}/cancel/`),
    exportData: (format = 'json') => api.get('/export/', {
        params: { type: format },
        responseType: 'blob',
    }),
    exportDataJSON: () => api.get('/export/json/'),
};

export const followApi = {
    toggle: (username) => api.post('/follows/toggle/', { username }),
    getFollowers: (username, params) => api.get(`/follows/followers/${username}/`, { params }),
    getFollowing: (username, params) => api.get(`/follows/following/${username}/`, { params }),
    getMutuals: (username, params) => api.get(`/follows/mutuals/${username}/`, { params }),
    check: (username) => api.get(`/follows/check/${username}/`),
    getFriendsWatching: (animeId) =>
        api.get('/follows/friends/watching/', { params: { anime_id: animeId } }),
};

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

export const badgeApi = {
    getMine: () => api.get('/badges/mine/'),
    updateFeatured: (badgeIds) => api.put('/badges/featured/', { badge_ids: badgeIds }),
};
