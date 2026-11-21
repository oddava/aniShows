import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { notify, notifyError } from '../ui/toast';
import { forumsApi } from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { forumKeys, invalidateForumLists } from '../../api/queries/forums';
import { patchCachedPosts, restorePosts, snapshotPosts } from './postsCache';

export const TOO_FAST_MESSAGE = 'You are doing that too fast. Please wait a moment.';

/** Toast text for a failed forum write: the throttle copy for 429, else the envelope `detail`. */
export const forumErrorMessage = (error, fallback) => (
    error?.response?.status === 429 ? TOO_FAST_MESSAGE : getApiErrorMessage(error, fallback)
);

const toastError = (fallback) => (error) => notifyError(forumErrorMessage(error, fallback));

/**
 * Every write on the thread page: replies, thread edit/delete/pin, likes,
 * follow (subscription) and staff moderation. Post writes patch every cached
 * posts payload of the thread (pages and "Continue this thread" subtrees).
 * The setters reset the page's form state after a successful write.
 */
export default function useThreadMutations({
    id,
    queryClient,
    setReplyContent,
    setShowReplyForm,
    setReplyTo,
    setEditingThread,
    setEditingPostId,
}) {
    const threadKey = forumKeys.thread(id);

    const patchThread = (patch) => {
        queryClient.setQueryData(threadKey, (old) => (old ? { ...old, ...patch } : old));
    };

    const optimisticThread = async (patch) => {
        await queryClient.cancelQueries({ queryKey: threadKey });
        const previous = queryClient.getQueryData(threadKey);
        queryClient.setQueryData(threadKey, (old) => (
            old ? { ...old, ...(typeof patch === 'function' ? patch(old) : patch) } : old
        ));
        return { previous };
    };

    const rollbackThread = (context) => {
        if (context?.previous !== undefined) {
            queryClient.setQueryData(threadKey, context.previous);
        }
    };

    const invalidatePosts = () => {
        queryClient.invalidateQueries({ queryKey: forumKeys.postsAll(id) });
        queryClient.invalidateQueries({ queryKey: threadKey });
    };

    const createPostMutation = useMutation({
        mutationFn: (data) => forumsApi.createPost(id, data),
        onSuccess: () => {
            invalidatePosts();
            setReplyContent('');
            setShowReplyForm(false);
            setReplyTo(null);
            notify('Reply posted');
        },
        onError: toastError('Failed to post reply'),
    });

    const updateThreadMutation = useMutation({
        mutationFn: (data) => forumsApi.updateThread(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: threadKey });
            setEditingThread(false);
            notify('Thread updated');
        },
        onError: toastError('Failed to update thread'),
    });

    const deleteThreadMutation = useMutation({
        mutationFn: () => forumsApi.deleteThread(id),
        onSuccess: () => {
            notify('Thread deleted');
            window.location.href = '/forums';
        },
        onError: toastError('Failed to delete thread'),
    });

    const togglePinMutation = useMutation({
        mutationFn: () => forumsApi.togglePin(id),
        onMutate: () => optimisticThread((old) => ({ is_pinned: !old.is_pinned })),
        onSuccess: (data) => {
            patchThread({ is_pinned: data.is_pinned });
            invalidateForumLists(queryClient);
            notify(data.is_pinned ? 'Thread pinned' : 'Thread unpinned');
        },
        onError: (error, _vars, context) => {
            rollbackThread(context);
            notifyError(forumErrorMessage(error, 'Failed to update pin status'));
        },
    });

    // Cooldown ref to prevent rapid-fire like clicks
    const threadLikeCooldownRef = useRef(false);

    // Idempotent like - only creates likes, never removes
    const likeThreadMutation = useMutation({
        mutationFn: () => forumsApi.likeThread(id),
        onMutate: () => optimisticThread((old) => (old.is_liked_by_user ? {} : {
            is_liked_by_user: true,
            like_count: (old.like_count || 0) + 1,
        })),
        onSuccess: (data) => patchThread({ like_count: data.like_count, is_liked_by_user: data.is_liked }),
        onError: (error, _vars, context) => {
            rollbackThread(context);
            notifyError(forumErrorMessage(error, 'Failed to like thread'));
        },
    });

    const unlikeThreadMutation = useMutation({
        mutationFn: () => forumsApi.unlikeThread(id),
        onMutate: () => optimisticThread((old) => (!old.is_liked_by_user ? {} : {
            is_liked_by_user: false,
            like_count: Math.max(0, (old.like_count || 0) - 1),
        })),
        onSuccess: (data) => patchThread({ like_count: data.like_count, is_liked_by_user: data.is_liked }),
        onError: (error, _vars, context) => {
            rollbackThread(context);
            notifyError(forumErrorMessage(error, 'Failed to unlike thread'));
        },
    });

    const toggleSubscriptionMutation = useMutation({
        mutationFn: (subscribe) => (subscribe ? forumsApi.subscribeThread(id) : forumsApi.unsubscribeThread(id)),
        onMutate: (subscribe) => optimisticThread({ is_subscribed: subscribe }),
        onSuccess: (data, subscribe) => {
            const isSubscribed = typeof data?.is_subscribed === 'boolean' ? data.is_subscribed : subscribe;
            patchThread({ is_subscribed: isSubscribed });
            notify(isSubscribed ? 'Following this thread' : 'Unfollowed this thread');
        },
        onError: (error, _vars, context) => {
            rollbackThread(context);
            notifyError(forumErrorMessage(error, 'Failed to update follow status'));
        },
    });

    const likePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.likePost(postId),
        onMutate: async (postId) => {
            const snapshot = await snapshotPosts(queryClient, id);
            patchCachedPosts(queryClient, id, postId, (post) => (post.is_liked_by_user ? {} : {
                is_liked_by_user: true,
                like_count: (post.like_count || 0) + 1,
            }));
            return { snapshot };
        },
        onSuccess: (data, postId) => patchCachedPosts(queryClient, id, postId, {
            like_count: data.like_count,
            is_liked_by_user: data.is_liked,
        }),
        onError: (error, _postId, context) => {
            restorePosts(queryClient, context?.snapshot);
            notifyError(forumErrorMessage(error, 'Failed to like reply'));
        },
    });

    const unlikePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.unlikePost(postId),
        onMutate: async (postId) => {
            const snapshot = await snapshotPosts(queryClient, id);
            patchCachedPosts(queryClient, id, postId, (post) => (!post.is_liked_by_user ? {} : {
                is_liked_by_user: false,
                like_count: Math.max(0, (post.like_count || 0) - 1),
            }));
            return { snapshot };
        },
        onSuccess: (data, postId) => patchCachedPosts(queryClient, id, postId, {
            like_count: data.like_count,
            is_liked_by_user: data.is_liked,
        }),
        onError: (error, _postId, context) => {
            restorePosts(queryClient, context?.snapshot);
            notifyError(forumErrorMessage(error, 'Failed to unlike reply'));
        },
    });

    const updatePostMutation = useMutation({
        mutationFn: ({ postId, data }) => forumsApi.updatePost(postId, data),
        onSuccess: (data, variables) => {
            patchCachedPosts(queryClient, id, variables.postId, {
                content: data?.content ?? variables.data.content,
                edited_at: data?.edited_at ?? new Date().toISOString(),
            });
            setEditingPostId(null);
            notify('Reply updated');
        },
        onError: toastError('Failed to update reply'),
    });

    // The author's delete: hard delete, or "[deleted]" placeholder when it has replies (server decides)
    const deletePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.deletePost(postId),
        onSuccess: () => {
            invalidatePosts();
            notify('Reply deleted');
        },
        onError: toastError('Failed to delete reply'),
    });

    // ---- Staff moderation ----
    const toggleLockMutation = useMutation({
        mutationFn: () => forumsApi.toggleThreadLock(id),
        onSuccess: (data) => {
            const isLocked = typeof data?.is_locked === 'boolean' ? data.is_locked : data?.status === 'locked';
            patchThread({ is_locked: isLocked });
            invalidateForumLists(queryClient);
            queryClient.invalidateQueries({ queryKey: forumKeys.postsAll(id) });
            notify(isLocked ? 'Thread locked' : 'Thread unlocked');
        },
        onError: toastError('Failed to update lock status'),
    });

    const removeThreadMutation = useMutation({
        mutationFn: (reason) => forumsApi.removeThread(id, reason),
        onSuccess: (_data, reason) => {
            patchThread({ is_removed: true, removal_reason: reason || '' });
            queryClient.invalidateQueries({ queryKey: threadKey });
            invalidateForumLists(queryClient);
            notify('Thread removed');
        },
        onError: toastError('Failed to remove thread'),
    });

    const restoreThreadMutation = useMutation({
        mutationFn: () => forumsApi.restoreThread(id),
        onSuccess: () => {
            patchThread({ is_removed: false, removal_reason: '' });
            queryClient.invalidateQueries({ queryKey: threadKey });
            invalidateForumLists(queryClient);
            notify('Thread restored');
        },
        onError: toastError('Failed to restore thread'),
    });

    const removePostMutation = useMutation({
        mutationFn: ({ postId, reason }) => forumsApi.removePost(postId, reason),
        onSuccess: (_data, { postId, reason }) => {
            patchCachedPosts(queryClient, id, postId, {
                is_removed: true,
                removal: 'moderator',
                removal_reason: reason || '',
            });
            invalidatePosts();
            notify('Reply removed');
        },
        onError: toastError('Failed to remove reply'),
    });

    const restorePostMutation = useMutation({
        mutationFn: (postId) => forumsApi.restorePost(postId),
        onSuccess: (_data, postId) => {
            patchCachedPosts(queryClient, id, postId, { is_removed: false, removal: null, removal_reason: '' });
            invalidatePosts();
            notify('Reply restored');
        },
        onError: toastError('Failed to restore reply'),
    });

    return {
        createPostMutation,
        updateThreadMutation,
        deleteThreadMutation,
        togglePinMutation,
        threadLikeCooldownRef,
        likeThreadMutation,
        unlikeThreadMutation,
        toggleSubscriptionMutation,
        likePostMutation,
        unlikePostMutation,
        updatePostMutation,
        deletePostMutation,
        toggleLockMutation,
        removeThreadMutation,
        restoreThreadMutation,
        removePostMutation,
        restorePostMutation,
    };
}
