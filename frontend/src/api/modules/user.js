import api from '../httpClient';

export const favoriteApi = {
    getAll: (params) => api.get('/favorites/', { params }),
    toggle: (animeId) => api.post('/favorites/toggle/', { anime_id: animeId }),
    reorder: (orderedItems) => api.post('/favorites/reorder/', { items: orderedItems }),
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
    vote: (id, isHelpful = true) => api.post(`/reviews/${id}/vote/`, { is_helpful: isHelpful }),
    getComments: (reviewId, page = 1, pageSize = 10) =>
        api.get(`/reviews/${reviewId}/comments/`, { params: { page, page_size: pageSize } }),
    addComment: (reviewId, text) => api.post(`/reviews/${reviewId}/add_comment/`, { text }),
    updateComment: (reviewId, commentId, text) =>
        api.patch(`/reviews/${reviewId}/comments/${commentId}/`, { text }),
    deleteComment: (reviewId, commentId) =>
        api.delete(`/reviews/${reviewId}/comments/${commentId}/delete/`),
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
