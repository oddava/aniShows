// API calls owned by G3 Lists (feature-revamp seams).
import api from '../httpClient';

export const activityApi = {
    /** `{ username, type, status, page, page_size }`: `status` is a list status ("Completed"). */
    getFeed: (params) => api.get('/activity/', { params }),
    getHeatmap: (params) => api.get('/activity/heatmap/', { params }),
};
