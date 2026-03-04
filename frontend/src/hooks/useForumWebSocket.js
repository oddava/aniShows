import { useCallback } from 'react';
import { useWebSocket } from './useWebSocket';

/**
 * Hook for real-time forum thread updates via WebSocket.
 *
 * Connects to `/ws/forums/threads/<threadId>/` and dispatches incoming
 * events to the provided callback handlers.
 *
 * @param {string|number|null} threadId - The thread ID to subscribe to, or null to skip.
 * @param {Object} handlers - Event callbacks.
 * @param {function} [handlers.onNewPost] - Called with the new post data.
 * @param {function} [handlers.onPostLiked] - Called with `{ post_id, like_count }`.
 * @param {function} [handlers.onThreadLiked] - Called with `{ thread_id, like_count }`.
 * @param {function} [handlers.onOpen] - Called when the WebSocket connection opens.
 * @param {function} [handlers.onClose] - Called when the WebSocket connection closes.
 * @returns {{ state: string, send: function, connect: function, disconnect: function }}
 */
export function useForumWebSocket(threadId, handlers = {}) {
    const handleMessage = useCallback((data) => {
        switch (data.type) {
            case 'new_post':
                handlers.onNewPost?.(data.post);
                break;

            case 'post_liked':
                handlers.onPostLiked?.({
                    post_id: data.post_id,
                    like_count: data.like_count,
                });
                break;

            case 'thread_liked':
                handlers.onThreadLiked?.({
                    thread_id: data.thread_id,
                    like_count: data.like_count,
                });
                break;

            default:
                break;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const path = threadId ? `/ws/forums/threads/${threadId}/` : null;

    return useWebSocket(
        path,
        {
            onMessage: handleMessage,
            onOpen: handlers.onOpen,
            onClose: handlers.onClose,
        },
        { autoConnect: !!threadId }
    );
}
