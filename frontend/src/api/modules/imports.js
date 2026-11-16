// API calls owned by G3 Lists (feature-revamp seams).
import api from '../httpClient';

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
