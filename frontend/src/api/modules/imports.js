// API calls owned by G3 Lists (feature-revamp seams).
import api from '../httpClient';

export const importExportApi = {
    importMAL: (username) => api.post('/import/mal/', { username }),
    /** A MyAnimeList export, `.xml` or `.xml.gz`. */
    importMALXML: (file) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/import/mal/xml/', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    /** Public AniList lists only: no access token is ever sent. */
    importAniList: (username) => api.post('/import/anilist/', { username }),
    getImportJobs: () => api.get('/import/jobs/'),
    getImportJobStatus: (jobId) => api.get(`/import/jobs/${jobId}/`),
    cancelImportJob: (jobId) => api.post(`/import/jobs/${jobId}/cancel/`),
    /** Linked AniList account (pull-only sync). */
    getAniListLink: () => api.get('/import/anilist/link/'),
    saveAniListLink: ({ username, autoSync }) => api.put('/import/anilist/link/', {
        username,
        auto_sync: autoSync,
    }),
    unlinkAniList: () => api.delete('/import/anilist/link/'),
    syncAniList: () => api.post('/import/anilist/sync/'),
    /** `json` (everything), `xml` (MAL list) or `csv` (list), as a Blob. */
    exportData: (format = 'json') => api.get('/export/', {
        params: { type: format },
        responseType: 'blob',
    }),
};
