import api from '../httpClient';

export const forumsApi = {
    getCategories: async () => {
        const response = await api.get('/forums/categories/');
        return response.data;
    },
    getCategory: async (slug) => {
        const response = await api.get(`/forums/categories/${slug}/`);
        return response.data;
    },
    getThreads: async (params) => {
        const response = await api.get('/forums/threads/', { params });
        return response.data;
    },
    getGlobalFeed: async (page = 1) => {
        const response = await api.get('/forums/threads/', {
            params: { page, ordering: '-updated_at' },
        });
        return response.data;
    },
    getThread: async (id) => {
        const response = await api.get(`/forums/threads/${id}/`);
        return response.data;
    },
    createThread: async (data) => {
        const response = await api.post('/forums/threads/', data);
        return response.data;
    },
    updateThread: async (id, data) => {
        const response = await api.patch(`/forums/threads/${id}/`, data);
        return response.data;
    },
    deleteThread: async (id) => {
        await api.delete(`/forums/threads/${id}/`);
    },
    togglePin: async (id) => {
        const response = await api.post(`/forums/threads/${id}/toggle_pin/`);
        return response.data;
    },
    likeThread: async (id) => {
        const response = await api.post(`/forums/threads/${id}/like/`);
        return response.data;
    },
    unlikeThread: async (id) => {
        const response = await api.post(`/forums/threads/${id}/unlike/`);
        return response.data;
    },
    toggleThreadLock: async (id) => {
        const response = await api.post(`/forums/threads/${id}/toggle_lock/`);
        return response.data;
    },
    removeThread: async (id, reason) => {
        const response = await api.post(`/forums/threads/${id}/remove/`, reason ? { reason } : {});
        return response.data;
    },
    restoreThread: async (id) => {
        const response = await api.post(`/forums/threads/${id}/restore/`);
        return response.data;
    },
    subscribeThread: async (id) => {
        const response = await api.post(`/forums/threads/${id}/subscription/`);
        return response.data;
    },
    unsubscribeThread: async (id) => {
        const response = await api.delete(`/forums/threads/${id}/subscription/`);
        return response.data;
    },
    getPosts: async (threadId, page = 1) => {
        const response = await api.get('/forums/posts/', {
            params: { thread__id: threadId, page, ordering: 'created_at' },
        });
        return response.data;
    },
    /**
     * One post and its subtree ("Continue this thread"), even off the current page.
     * `page` pages the post's direct replies, so a very wide reply list stays reachable.
     */
    getPostSubtree: async (threadId, rootId, page = 1) => {
        const response = await api.get('/forums/posts/', {
            params: { thread__id: threadId, root: rootId, page },
        });
        return response.data;
    },
    createPost: async (threadId, data) => {
        const response = await api.post('/forums/posts/', { ...data, thread: threadId });
        return response.data;
    },
    updatePost: async (id, data) => {
        const response = await api.patch(`/forums/posts/${id}/`, data);
        return response.data;
    },
    deletePost: async (id) => {
        await api.delete(`/forums/posts/${id}/`);
    },
    likePost: async (id) => {
        const response = await api.post(`/forums/posts/${id}/like/`);
        return response.data;
    },
    unlikePost: async (id) => {
        const response = await api.post(`/forums/posts/${id}/unlike/`);
        return response.data;
    },
    removePost: async (id, reason) => {
        const response = await api.post(`/forums/posts/${id}/remove/`, reason ? { reason } : {});
        return response.data;
    },
    restorePost: async (id) => {
        const response = await api.post(`/forums/posts/${id}/restore/`);
        return response.data;
    },
    getTags: async () => {
        const response = await api.get('/forums/tags/');
        return response.data;
    },
};
