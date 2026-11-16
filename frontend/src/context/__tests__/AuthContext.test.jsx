import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../AuthContext';
import { authApi, hasSession, refreshAccessToken } from '../../api/client';
import { clearUserContext, setUserContext } from '../../sentry';

vi.mock('../../api/client', () => ({
    AUTH_EXPIRED_EVENT: 'auth:expired',
    SESSION_HINT_KEY: 'auth_session',
    authApi: {
        getProfile: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        register: vi.fn(),
    },
    clearSession: vi.fn(),
    hasSession: vi.fn(),
    isAuthFailureError: vi.fn(() => false),
    refreshAccessToken: vi.fn(),
    setAccessToken: vi.fn(),
}));

vi.mock('../../sentry', () => ({
    setUserContext: vi.fn(),
    clearUserContext: vi.fn(),
}));

vi.mock('../../utils/dateUtils', () => ({
    clearStoredTimeZonePreference: vi.fn(),
    syncStoredTimeZonePreference: vi.fn(),
}));

const alice = { id: 1, username: 'alice', preferred_timezone: 'auto' };
const bob = { id: 2, username: 'bob', preferred_timezone: 'auto' };

let auth;
function Capture() {
    auth = useAuth();
    return null;
}

const renderProvider = async ({ signedInAs = null } = {}) => {
    hasSession.mockReturnValue(Boolean(signedInAs));
    refreshAccessToken.mockResolvedValue('access-token');
    authApi.getProfile.mockResolvedValue({ data: signedInAs });
    const queryClient = new QueryClient();
    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <Capture />
            </AuthProvider>
        </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.loading).toBe(false));
    return queryClient;
};

const seedPerUserData = (queryClient) => {
    queryClient.setQueryData(['ownProfile'], { username: 'alice' });
    queryClient.setQueryData(['user', 'list', 'watching'], [{ id: 9 }]);
};

const cachedKeys = (queryClient) =>
    queryClient.getQueryCache().getAll().map((query) => query.queryKey);

describe('AuthContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.logout.mockResolvedValue({});
    });

    it('clears the query cache and the Sentry user on logout', async () => {
        const queryClient = await renderProvider({ signedInAs: alice });
        expect(auth.user).toEqual(alice);
        expect(setUserContext).toHaveBeenCalledWith(alice);
        seedPerUserData(queryClient);

        await act(() => auth.logout());

        expect(auth.user).toBeNull();
        expect(cachedKeys(queryClient)).toEqual([]);
        expect(clearUserContext).toHaveBeenCalled();
    });

    it('clears the cache even when the logout request fails', async () => {
        authApi.logout.mockRejectedValue(new Error('offline'));
        const queryClient = await renderProvider({ signedInAs: alice });
        seedPerUserData(queryClient);

        await act(() => auth.logout());

        expect(cachedKeys(queryClient)).toEqual([]);
    });

    it('clears the cache when the session expires', async () => {
        const queryClient = await renderProvider({ signedInAs: alice });
        seedPerUserData(queryClient);

        act(() => {
            window.dispatchEvent(new Event('auth:expired'));
        });

        expect(auth.user).toBeNull();
        expect(cachedKeys(queryClient)).toEqual([]);
    });

    it('clears the cache when another tab signs out', async () => {
        const queryClient = await renderProvider({ signedInAs: alice });
        seedPerUserData(queryClient);

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'auth_session', newValue: null }));
        });

        expect(auth.user).toBeNull();
        expect(cachedKeys(queryClient)).toEqual([]);
    });

    it('clears the cache when a different account starts a session', async () => {
        const queryClient = await renderProvider({ signedInAs: alice });
        seedPerUserData(queryClient);

        await act(() => auth.startSession('bob-token', bob));

        expect(auth.user).toEqual(bob);
        expect(cachedKeys(queryClient)).toEqual([]);
        expect(setUserContext).toHaveBeenLastCalledWith(bob);
    });

    it('keeps the cache when the same account refreshes its profile', async () => {
        const queryClient = await renderProvider({ signedInAs: alice });
        seedPerUserData(queryClient);

        await act(() => auth.refreshProfile({ ...alice, bio: 'new' }));

        expect(cachedKeys(queryClient)).toHaveLength(2);
        expect(clearUserContext).not.toHaveBeenCalled();
    });
});
