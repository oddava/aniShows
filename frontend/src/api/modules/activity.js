// API calls owned by G3 Lists (feature-revamp seams).
import api from '../httpClient';

export const activityApi = {
    getFeed: (params) => api.get('/activity/', { params }),
    getHeatmap: (params) => api.get('/activity/heatmap/', { params }),
};
