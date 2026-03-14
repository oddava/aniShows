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
    toggleThreadLike: async (id) => {
        const response = await api.post(`/forums/threads/${id}/like/`);
        return response.data;
    },
    getPosts: async (threadId, page = 1) => {
        const response = await api.get('/forums/posts/', {
            params: { thread__id: threadId, page, ordering: 'created_at' },
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
    togglePostLike: async (id) => {
        const response = await api.post(`/forums/posts/${id}/like/`);
        return response.data;
    },
    getTags: async () => {
        const response = await api.get('/forums/tags/');
        return response.data;
    },
};
