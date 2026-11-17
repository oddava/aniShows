import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useForumWebSocket } from '../useForumWebSocket';
import { useWebSocket } from '../useWebSocket';

vi.mock('../useWebSocket', () => ({ useWebSocket: vi.fn(() => ({ state: 'open' })) }));

const lastOnMessage = () => useWebSocket.mock.calls.at(-1)[1].onMessage;

describe('useForumWebSocket', () => {
    beforeEach(() => useWebSocket.mockClear());

    it('connects to the thread path only when a thread id is given', () => {
        renderHook(() => useForumWebSocket(7));
        expect(useWebSocket.mock.calls.at(-1)[0]).toBe('/ws/forums/threads/7/');
        renderHook(() => useForumWebSocket(null));
        expect(useWebSocket.mock.calls.at(-1)[0]).toBeNull();
    });

    it('dispatches edit, removal and restore events to their handlers', () => {
        const handlers = { onPostUpdated: vi.fn(), onPostRemoved: vi.fn(), onPostRestored: vi.fn() };
        renderHook(() => useForumWebSocket(7, handlers));
        const onMessage = lastOnMessage();

        onMessage({ type: 'post_updated', post: { id: 1, content: 'new', edited_at: 'now' } });
        onMessage({ type: 'post_removed', post_id: 2 });
        onMessage({ type: 'post_restored', post_id: 3 });
        onMessage({ type: 'post_restored' });

        expect(handlers.onPostUpdated).toHaveBeenCalledWith({ id: 1, content: 'new', edited_at: 'now' });
        expect(handlers.onPostRemoved).toHaveBeenCalledWith({ post_id: 2, removal: 'moderator' });
        expect(handlers.onPostRestored).toHaveBeenCalledTimes(1);
        expect(handlers.onPostRestored).toHaveBeenCalledWith({ post_id: 3 });
    });
});
