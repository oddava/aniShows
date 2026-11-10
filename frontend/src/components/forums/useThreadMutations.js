import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { forumsApi } from '../../api/client';
import { forumKeys } from '../../api/queries/forums';

/**
 * Every write on the thread page: replies, thread edit/delete/pin, and the
 * optimistic like/unlike for the thread and its posts (on `forumKeys.thread`
 * and `forumKeys.posts(id, page)`). The setters reset the page's form state
 * after a successful write.
 */
export default function useThreadMutations({
    id,
    page,
    queryClient,
    setReplyContent,
    setShowReplyForm,
    setReplyTo,
    setEditingThread,
    setEditingPostId,
}) {
    const createPostMutation = useMutation({
        mutationFn: (data) => forumsApi.createPost(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: forumKeys.postsAll(id) });
            queryClient.invalidateQueries({ queryKey: forumKeys.thread(id) });
            setReplyContent('');
            setShowReplyForm(false);
            setReplyTo(null);
            toast.success('Reply posted!');
        },
        onError: (error) => {
            toast.error(error.response?.data?.message || 'Failed to post reply');
        }
    });

    const updateThreadMutation = useMutation({
        mutationFn: (data) => forumsApi.updateThread(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: forumKeys.thread(id) });
            setEditingThread(false);
            toast.success('Thread updated!');
        }
    });

    const deleteThreadMutation = useMutation({
        mutationFn: () => forumsApi.deleteThread(id),
        onSuccess: () => {
            toast.success('Thread deleted');
            window.location.href = '/forums';
        },
        onError: (error) => {
            toast.error(error.response?.data?.message || 'Failed to delete thread');
        }
    });

    const togglePinMutation = useMutation({
        mutationFn: () => forumsApi.togglePin(id),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: forumKeys.thread(id) });
            const previous = queryClient.getQueryData(forumKeys.thread(id));
            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) return old;
                return { ...old, is_pinned: !old.is_pinned };
            });
            return { previous };
        },
        onSuccess: (data) => {
            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) return old;
                return { ...old, is_pinned: data.is_pinned };
            });
            queryClient.invalidateQueries({ queryKey: forumKeys.threadsAll });
            toast.success(data.is_pinned ? 'Thread pinned' : 'Thread unpinned');
        },
        onError: (err, _vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(forumKeys.thread(id), context.previous);
            }
            toast.error('Failed to update pin status');
        },
    });

    // Cooldown refs to prevent rapid-fire like clicks
    const threadLikeCooldownRef = useRef(false);

    // Idempotent like mutation - only creates likes, never removes
    const likeThreadMutation = useMutation({
        mutationFn: () => forumsApi.likeThread(id),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: forumKeys.thread(id) });
            const previous = queryClient.getQueryData(forumKeys.thread(id));

            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) {
                    return old;
                }
                // Only optimistic update if not already liked
                if (old.is_liked_by_user) {
                    return old;
                }
                const newCount = (old.like_count || 0) + 1;
                return {
                    ...old,
                    is_liked_by_user: true,
                    like_count: newCount,
                };
            });

            return { previous };
        },
        onSuccess: (data) => {
            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) return old;
                return {
                    ...old,
                    like_count: data.like_count,
                    is_liked_by_user: data.is_liked,
                };
            });
        },
        onError: (err, _vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(forumKeys.thread(id), context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to like thread');
            }
        },
    });

    // Unlike mutation - only removes likes
    const unlikeThreadMutation = useMutation({
        mutationFn: () => forumsApi.unlikeThread(id),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: forumKeys.thread(id) });
            const previous = queryClient.getQueryData(forumKeys.thread(id));
            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) return old;
                // Only optimistic update if currently liked
                if (!old.is_liked_by_user) return old;
                return {
                    ...old,
                    is_liked_by_user: false,
                    like_count: Math.max(0, (old.like_count || 0) - 1),
                };
            });
            return { previous };
        },
        onSuccess: (data) => {
            queryClient.setQueryData(forumKeys.thread(id), old => {
                if (!old) return old;
                return {
                    ...old,
                    like_count: data.like_count,
                    is_liked_by_user: data.is_liked, // Always false for unlike action
                };
            });
        },
        onError: (err, _vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(forumKeys.thread(id), context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to unlike thread');
            }
        },
    });

    // Idempotent like mutation for posts
    const likePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.likePost(postId),
        onMutate: async (postId) => {
            await queryClient.cancelQueries({ queryKey: forumKeys.posts(id, page) });
            const previous = queryClient.getQueryData(forumKeys.posts(id, page));

            queryClient.setQueryData(forumKeys.posts(id, page), old => {
                if (!old?.results) {
                    return old;
                }
                const updatedResults = old.results.map(post => {
                    if (post.id !== postId) return post;

                    // Only increment if not already liked
                    if (post.is_liked_by_user) {
                        return post;
                    }

                    const newCount = (post.like_count || 0) + 1;
                    return {
                        ...post,
                        is_liked_by_user: true,
                        like_count: newCount,
                    };
                });

                return { ...old, results: updatedResults };
            });

            return { previous };
        },
        onSuccess: (data, postId) => {
            queryClient.setQueryData(forumKeys.posts(id, page), old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === postId
                            ? {
                                ...post,
                                like_count: data.like_count,
                                is_liked_by_user: data.is_liked,
                            }
                            : post
                    ),
                };
            });
        },
        onError: (err, _postId, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(forumKeys.posts(id, page), context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to like reply');
            }
        },
    });

    // Unlike mutation for posts
    const unlikePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.unlikePost(postId),
        onMutate: async (postId) => {
            await queryClient.cancelQueries({ queryKey: forumKeys.posts(id, page) });
            const previous = queryClient.getQueryData(forumKeys.posts(id, page));
            queryClient.setQueryData(forumKeys.posts(id, page), old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === postId
                            ? {
                                ...post,
                                // Only decrement if currently liked
                                ...(post.is_liked_by_user ? {
                                    is_liked_by_user: false,
                                    like_count: Math.max(0, (post.like_count || 0) - 1),
                                } : {}),
                            }
                            : post
                    ),
                };
            });
            return { previous };
        },
        onSuccess: (data, postId) => {
            queryClient.setQueryData(forumKeys.posts(id, page), old => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === postId
                            ? {
                                ...post,
                                like_count: data.like_count,
                                is_liked_by_user: data.is_liked,
                            }
                            : post
                    ),
                };
            });
        },
        onError: (err, _postId, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(forumKeys.posts(id, page), context.previous);
            }
            if (err.response?.status === 429) {
                toast.error('You are doing that too fast. Please wait a moment.');
            } else {
                toast.error('Failed to unlike reply');
            }
        },
    });

    const updatePostMutation = useMutation({
        mutationFn: ({ postId, data }) => forumsApi.updatePost(postId, data),
        onSuccess: (data, variables) => {
            // Immediately update the cache with the new content
            queryClient.setQueryData(forumKeys.posts(id, page), (old) => {
                if (!old?.results) return old;
                return {
                    ...old,
                    results: old.results.map(post =>
                        post.id === variables.postId
                            ? { ...post, content: variables.data.content, updated_at: new Date().toISOString() }
                            : post
                    )
                };
            });
            setEditingPostId(null);
            toast.success('Reply updated!');
        }
    });

    const deletePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.deletePost(postId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: forumKeys.posts(id, page) });
            queryClient.invalidateQueries({ queryKey: forumKeys.thread(id) });
            toast.success('Reply deleted');
        },
        onError: (error) => {
            toast.error(error.response?.data?.message || 'Failed to delete reply');
        }
    });

    return {
        createPostMutation,
        updateThreadMutation,
        deleteThreadMutation,
        togglePinMutation,
        threadLikeCooldownRef,
        likeThreadMutation,
        unlikeThreadMutation,
        likePostMutation,
        unlikePostMutation,
        updatePostMutation,
        deletePostMutation,
    };
}
