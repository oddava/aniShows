// API calls owned by G5 Community (feature-revamp seams).
import api from '../httpClient';

export const followApi = {
    toggle: (username) => api.post('/follows/toggle/', { username }),
    getFollowers: (username, params) => api.get(`/follows/followers/${username}/`, { params }),
    getFollowing: (username, params) => api.get(`/follows/following/${username}/`, { params }),
    getMutuals: (username, params) => api.get(`/follows/mutuals/${username}/`, { params }),
    check: (username) => api.get(`/follows/check/${username}/`),
    getFriendsWatching: (animeId) =>
        api.get('/follows/friends/watching/', { params: { anime_id: animeId } }),
};
