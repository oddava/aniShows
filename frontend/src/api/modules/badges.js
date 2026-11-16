// API calls owned by G5 Community (feature-revamp seams).
import api from '../httpClient';

export const badgeApi = {
    getMine: () => api.get('/badges/mine/'),
    updateFeatured: (badgeIds) => api.put('/badges/featured/', { badge_ids: badgeIds }),
};
