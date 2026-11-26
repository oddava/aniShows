import api from '../api/httpClient';

/*
 * The admin's one door to `/api/v1/admin/`. Paths are relative to that root
 * ('users', 'users/12/suspend'); a trailing slash is added. Every call
 * resolves to the response body, not the axios response.
 */

const url = (path) => `/admin/${String(path).replace(/^\/+|\/+$/g, '')}/`;

/** Drop empty values so URLs stay short and query keys stay stable. */
export function cleanParams(params = {}) {
    return Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    );
}

const body = (response) => response.data;

export const adminApi = {
    get: (path, params, config) => api.get(url(path), { params: cleanParams(params), ...config }).then(body),
    post: (path, data, config) => api.post(url(path), data, config).then(body),
    put: (path, data, config) => api.put(url(path), data, config).then(body),
    patch: (path, data, config) => api.patch(url(path), data, config).then(body),
    /** DELETE; `data` goes in the body (a removal reason). */
    del: (path, params, data) => api.delete(url(path), { params: cleanParams(params), data }).then(body),
    /** Multipart writes (badge images). `data` is a FormData. */
    upload: (method, path, data) => api.request({
        method,
        url: url(path),
        data,
        headers: { 'Content-Type': 'multipart/form-data' },
    }).then(body),
    /** Save a file the API streams back (CSV exports). */
    download: async (path, params, filename) => {
        let response;
        try {
            response = await api.get(url(path), { params: cleanParams(params), responseType: 'blob' });
        } catch (error) {
            // A blob response hides the JSON error; read it back so the message shows.
            const blob = error?.response?.data;
            if (blob && typeof blob.text === 'function') {
                try {
                    error.response.data = JSON.parse(await blob.text());
                } catch {
                    // Not JSON: keep the generic message.
                }
            }
            throw error;
        }
        const href = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    },
};

/** Public (non-admin) API, for the few admin views that reuse site endpoints. */
export const publicApi = {
    get: (path, params) => api.get(path, { params: cleanParams(params) }).then(body),
};

/*
 * Query keys. Everything lives under ['admin'], so no public-site
 * invalidation touches admin caches and `adminKeys.all` refetches them all.
 * `resource` is the API path ('users', 'forum-threads', 'moderation/reviews').
 */
export const adminKeys = {
    all: ['admin'],
    resource: (resource) => ['admin', resource],
    list: (resource, params) => ['admin', resource, 'list', cleanParams(params)],
    detail: (resource, id) => ['admin', resource, 'detail', String(id)],
    view: (resource, params) => (params ? ['admin', resource, 'view', cleanParams(params)] : ['admin', resource, 'view']),
};

/**
 * The message to show for a failed request: the API's `detail`, else the
 * first field error, else `fallback`.
 */
export function errorMessage(error, fallback = 'Something went wrong. Try again.') {
    const data = error?.response?.data;
    if (!data) return error?.response ? fallback : 'Could not reach the server. Check your connection.';
    if (typeof data === 'string') return fallback;
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.message === 'string' && error.response.status >= 400) return data.message;
    if (data.errors && typeof data.errors === 'object') {
        const first = Object.entries(data.errors)[0];
        if (first) return `${first[0]}: ${[].concat(first[1])[0]}`;
    }
    const field = Object.entries(data).find(([, value]) => Array.isArray(value) && typeof value[0] === 'string');
    if (field) return field[0] === 'non_field_errors' ? field[1][0] : `${humanizeField(field[0])}: ${field[1][0]}`;
    return fallback;
}

/**
 * Field errors keyed by field name, for inline form messages. Reads the API's
 * envelope (`{ code, detail, errors: { field: ['…'] } }`) and, for older
 * endpoints, DRF's bare `{ field: ['…'] }`.
 */
export function fieldErrors(error) {
    const data = error?.response?.data;
    if (!data || typeof data !== 'object') return {};
    const source = data.errors && typeof data.errors === 'object' && !Array.isArray(data.errors) ? data.errors : data;
    return Object.fromEntries(
        Object.entries(source)
            .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
            .filter(([key, value]) => typeof value === 'string' && !['detail', 'code', 'message'].includes(key)),
    );
}

const humanizeField = (name) => {
    const text = name.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
};
