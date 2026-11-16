import { useCallback, useEffect, useRef } from 'react';
import { useWebSocket } from './useWebSocket';

/**
 * Hook for real-time forum thread updates via WebSocket.
 *
 * Connects to `/ws/forums/threads/<threadId>/` and dispatches incoming
 * events to the provided callback handlers. The latest handlers are always
 * used (they may close over the current page or user).
 *
 * @param {string|number|null} threadId - The thread ID to subscribe to, or null to skip.
 * @param {Object} handlers - Event callbacks.
 * @param {function} [handlers.onNewPost] - Called with the new post data.
 * @param {function} [handlers.onPostLiked] - Called with `{ post_id, like_count }`.
 * @param {function} [handlers.onThreadLiked] - Called with `{ thread_id, like_count }`.
 * @param {function} [handlers.onPostUpdated] - Called with `{ id, content, edited_at }`.
 * @param {function} [handlers.onPostRemoved] - Called with `{ post_id, removal }`.
 * @param {function} [handlers.onOpen] - Called when the WebSocket connection opens.
 * @param {function} [handlers.onClose] - Called when the WebSocket connection closes.
 * @returns {{ state: string, send: function, connect: function, disconnect: function }}
 */
export function useForumWebSocket(threadId, handlers = {}) {
    const handlersRef = useRef(handlers);
    useEffect(() => {
        handlersRef.current = handlers;
    });

    const handleMessage = useCallback((data) => {
        const current = handlersRef.current;
        switch (data?.type) {
            case 'new_post':
                current.onNewPost?.(data.post);
                break;

            case 'post_liked':
                current.onPostLiked?.({
                    post_id: data.post_id,
                    like_count: data.like_count,
                });
                break;

            case 'thread_liked':
                current.onThreadLiked?.({
                    thread_id: data.thread_id,
                    like_count: data.like_count,
                });
                break;

            case 'post_updated':
                if (data.post?.id != null) current.onPostUpdated?.(data.post);
                break;

            case 'post_removed':
                if (data.post_id != null) {
                    current.onPostRemoved?.({ post_id: data.post_id, removal: data.removal ?? 'moderator' });
                }
                break;

            default:
                break;
        }
    }, []);

    const handleOpen = useCallback((...args) => handlersRef.current.onOpen?.(...args), []);
    const handleClose = useCallback((...args) => handlersRef.current.onClose?.(...args), []);

    const path = threadId ? `/ws/forums/threads/${threadId}/` : null;

    return useWebSocket(
        path,
        {
            onMessage: handleMessage,
            onOpen: handleOpen,
            onClose: handleClose,
        },
        { autoConnect: !!threadId }
    );
}
