import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];

vi.mock('../../components/notifications/pushClient', () => ({
    detachOnLogout: vi.fn(async () => {
        calls.push('detach');
    }),
}));

vi.mock('../../api/client', () => ({
    AUTH_EXPIRED_EVENT: 'auth:expired',
    SESSION_HINT_KEY: 'session-hint',
    authApi: {
        logout: vi.fn(async () => {
            calls.push('logout');
        }),
        getProfile: vi.fn(),
    },
    clearSession: vi.fn(() => {
        calls.push('clearSession');
    }),
    hasSession: vi.fn(() => false),
    isAuthFailureError: vi.fn(() => false),
    refreshAccessToken: vi.fn(),
    setAccessToken: vi.fn(),
}));

vi.mock('../../sentry', () => ({ clearUserContext: vi.fn(), setUserContext: vi.fn() }));

const { AuthProvider, useAuth } = await import('../AuthContext');
const { detachOnLogout } = await import('../../components/notifications/pushClient');
const { authApi } = await import('../../api/client');

const renderAuth = () => {
    let auth;
    const Probe = () => {
        auth = useAuth();
        return null;
    };
    render(
        <QueryClientProvider client={new QueryClient()}>
            <AuthProvider><Probe /></AuthProvider>
        </QueryClientProvider>,
    );
    return () => auth;
};

describe('AuthContext logout (C-G1-3)', () => {
    beforeEach(() => {
        calls.length = 0;
        vi.clearAllMocks();
    });

    it('detaches web push before the session is revoked and cleared', async () => {
        const auth = renderAuth();
        await waitFor(() => expect(auth().loading).toBe(false));

        await act(() => auth().logout());

        expect(detachOnLogout).toHaveBeenCalledTimes(1);
        // The unsubscribe call needs a live session, so it runs first.
        expect(calls).toEqual(['detach', 'logout', 'clearSession']);
    });

    it('still signs out when the logout request fails', async () => {
        authApi.logout.mockRejectedValueOnce(new Error('offline'));
        const auth = renderAuth();
        await waitFor(() => expect(auth().loading).toBe(false));

        await act(() => auth().logout());

        expect(detachOnLogout).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(['detach', 'clearSession']);
    });
});
