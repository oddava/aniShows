import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../api/modules/auth';
import { clearSession, setAccessToken } from '../../api/httpClient';
import { useWebSocket } from '../useWebSocket';

vi.mock('../../api/modules/auth', () => ({
    authApi: { getWsTicket: vi.fn() },
}));

class FakeWebSocket {
    static instances = [];
    static OPEN = 1;

    constructor(url) {
        this.url = url;
        this.readyState = 0;
        FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {}
}

describe('useWebSocket auth', () => {
    const originalWebSocket = globalThis.WebSocket;

    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket;
        vi.clearAllMocks();
    });

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket;
        clearSession();
    });

    it('connects with a single-use ticket instead of the JWT', async () => {
        setAccessToken('secret-access-token');
        authApi.getWsTicket.mockResolvedValue({ data: { ticket: 'tick/et+1' } });

        renderHook(() => useWebSocket('/ws/notifications/'));

        await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
        const { url } = FakeWebSocket.instances[0];
        expect(url).toMatch(/\/ws\/notifications\/\?ticket=tick%2Fet%2B1$/);
        expect(url).not.toContain('secret-access-token');
        expect(url).not.toContain('token=');
    });

    it('does not connect or fetch a ticket when signed out', async () => {
        clearSession();

        renderHook(() => useWebSocket('/ws/notifications/'));

        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(authApi.getWsTicket).not.toHaveBeenCalled();
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('stops when the ticket request says the session is gone', async () => {
        setAccessToken('expired');
        authApi.getWsTicket.mockRejectedValue({ response: { status: 401 } });

        renderHook(() => useWebSocket('/ws/notifications/', {}, { baseDelay: 1 }));

        await waitFor(() => expect(authApi.getWsTicket).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(authApi.getWsTicket).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances).toHaveLength(0);
    });
});
