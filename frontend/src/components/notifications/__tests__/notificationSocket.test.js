import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../../../api/modules/auth';
import { clearSession, setAccessToken } from '../../../api/httpClient';
import {
    resetNotificationSocketForTests,
    subscribeNotificationSocket,
} from '../notificationSocket';

vi.mock('../../../api/modules/auth', () => ({
    authApi: { getWsTicket: vi.fn() },
}));
vi.mock('../../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

class FakeWebSocket {
    static instances = [];
    static OPEN = 1;

    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.close = vi.fn();
        this.send = vi.fn();
        FakeWebSocket.instances.push(this);
    }

    open() {
        this.readyState = 1;
        this.onopen?.();
    }

    message(data) {
        this.onmessage?.({ data: JSON.stringify(data) });
    }

    drop(code = 1006) {
        this.readyState = 3;
        this.onclose?.({ code });
    }
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe('notification socket', () => {
    const originalWebSocket = globalThis.WebSocket;

    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket;
        authApi.getWsTicket.mockReset();
        authApi.getWsTicket.mockResolvedValue({ data: { ticket: 't' } });
        setAccessToken('access');
    });

    afterEach(() => {
        resetNotificationSocketForTests();
        globalThis.WebSocket = originalWebSocket;
        clearSession();
        vi.useRealTimers();
    });

    it('shares one socket between three subscribers', async () => {
        const received = [vi.fn(), vi.fn(), vi.fn()];
        received.forEach((onMessage) => subscribeNotificationSocket({ userId: 1, onMessage }));

        await vi.advanceTimersByTimeAsync(150);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(authApi.getWsTicket).toHaveBeenCalledTimes(1);
        expect(latest().url).toMatch(/\/ws\/notifications\/\?ticket=t$/);

        latest().open();
        latest().message({ type: 'unread_count', count: 4 });
        latest().message({ type: 'pong' });
        received.forEach((onMessage) => {
            expect(onMessage).toHaveBeenCalledTimes(1);
            expect(onMessage).toHaveBeenCalledWith({ type: 'unread_count', count: 4 });
        });
    });

    it('closes only when the last subscriber leaves', async () => {
        const leave = [1, 2, 3].map(() => subscribeNotificationSocket({ userId: 1, onMessage: vi.fn() }));
        await vi.advanceTimersByTimeAsync(150);
        const socket = latest();
        socket.open();

        leave[0]();
        leave[1]();
        leave[1](); // Leaving twice doesn't count twice.
        expect(socket.close).not.toHaveBeenCalled();

        leave[2]();
        expect(socket.close).toHaveBeenCalledWith(1000, 'Client disconnect');
    });

    it('opens nothing when subscribers come and go before it connects (StrictMode)', async () => {
        const leave = subscribeNotificationSocket({ userId: 1, onMessage: vi.fn() });
        leave();
        subscribeNotificationSocket({ userId: 1, onMessage: vi.fn() });
        await vi.advanceTimersByTimeAsync(150);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('invalidates the user’s notification queries once per reopen after a drop', async () => {
        const queryClient = new QueryClient();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        subscribeNotificationSocket({ userId: 1, queryClient, onMessage: vi.fn() });
        subscribeNotificationSocket({ userId: 1, queryClient, onMessage: vi.fn() });

        await vi.advanceTimersByTimeAsync(150);
        latest().open();
        expect(invalidate).not.toHaveBeenCalled();

        latest().drop(1006);
        await vi.advanceTimersByTimeAsync(1500);
        expect(FakeWebSocket.instances).toHaveLength(2);
        latest().open();

        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 1] });
    });

    it('does not reconnect after a 4401 close', async () => {
        subscribeNotificationSocket({ userId: 1, onMessage: vi.fn() });
        await vi.advanceTimersByTimeAsync(150);
        latest().open();
        latest().drop(4401);

        await vi.advanceTimersByTimeAsync(60000);
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(10);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('resumes on online after giving up', async () => {
        authApi.getWsTicket.mockRejectedValue(new Error('network down'));
        subscribeNotificationSocket({ userId: 1, onMessage: vi.fn() });

        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        const callsWhenGivenUp = authApi.getWsTicket.mock.calls.length;
        expect(callsWhenGivenUp).toBe(11); // the first try plus 10 retries
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(authApi.getWsTicket).toHaveBeenCalledTimes(callsWhenGivenUp);

        authApi.getWsTicket.mockResolvedValue({ data: { ticket: 't' } });
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(10);
        expect(authApi.getWsTicket).toHaveBeenCalledTimes(callsWhenGivenUp + 1);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});
