import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import useAdultContentPreference from '../useAdultContentPreference';

const authApi = vi.hoisted(() => ({ updateProfile: vi.fn() }));
const auth = vi.hoisted(() => ({ value: null }));

vi.mock('../../api/client', () => ({ authApi, animeApi: {}, listApi: {} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth.value }));

function setup(options) {
    const client = new QueryClient();
    const remove = vi.spyOn(client, 'removeQueries');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useAdultContentPreference(options), { wrapper });
    return { ...hook, client, remove, invalidate };
}

beforeEach(() => {
    authApi.updateProfile.mockReset();
    auth.value = {
        isAuthenticated: true,
        user: { show_adult_content: false },
        refreshProfile: vi.fn().mockResolvedValue(undefined),
    };
});

describe('useAdultContentPreference (G1 contract stub, Browse/Schedule behaviour)', () => {
    it('reports the current preference', () => {
        const { result } = setup();
        expect(result.current.enabled).toBe(false);
        expect(result.current.isUpdating).toBe(false);
    });

    it('PATCHes, refreshes the profile and drops anime queries', async () => {
        const profile = { show_adult_content: true };
        authApi.updateProfile.mockResolvedValue({ data: profile });
        const { result, client, remove, invalidate } = setup({ alsoRemove: [['schedule']] });

        await act(() => result.current.toggle());

        expect(authApi.updateProfile).toHaveBeenCalledWith({ show_adult_content: true });
        expect(auth.value.refreshProfile).toHaveBeenCalledWith(profile);
        expect(client.getQueryData(['ownProfile'])).toEqual(profile);
        expect(remove.mock.calls.map(([arg]) => arg.queryKey)).toEqual([['schedule'], ['anime']]);
        expect(invalidate.mock.calls.map(([arg]) => arg.queryKey)).toEqual([['ownProfile'], ['profile']]);
    });

    it('does nothing for guests', async () => {
        auth.value = { ...auth.value, isAuthenticated: false };
        const { result } = setup();
        await act(() => result.current.toggle());
        expect(authApi.updateProfile).not.toHaveBeenCalled();
    });
});
