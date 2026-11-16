import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useProfileSettings from '../useProfileSettings';
import { authApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
    authApi: {
        updateProfile: vi.fn(),
    },
}));

vi.mock('../../../utils/logger', () => ({
    default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const storedLink = (platform, url) => ({
    platform,
    url,
    value: url,
    normalized_url: url,
    domain: new URL(url).hostname,
    trust_level: 'verified',
    metadata: {},
    metadata_pending: false,
});

const user = {
    id: 1,
    username: 'linker',
    bio: 'old bio',
    is_private: false,
    profile_primary_color: '#75698d',
    preferred_timezone: 'auto',
    social_links: [
        storedLink('twitter', 'https://twitter.com/someone'),
        storedLink('github', 'https://github.com/someone'),
        storedLink('youtube', 'https://youtube.com/@someone'),
    ],
};

const setup = () => {
    const queryClient = { setQueryData: vi.fn(), invalidateQueries: vi.fn() };
    const refreshProfile = vi.fn();
    const hook = renderHook(() => useProfileSettings({ user, refreshProfile, queryClient }));
    return { ...hook, queryClient, refreshProfile };
};

const sentFormData = () => authApi.updateProfile.mock.calls[0][0];

describe('useProfileSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.updateProfile.mockResolvedValue({ data: { ...user, bio: 'new bio' } });
    });

    it('does not send social_links when only the bio changed', async () => {
        const { result } = setup();

        act(() => result.current.setBio('new bio'));
        await act(() => result.current.handleSaveProfile());

        expect(authApi.updateProfile).toHaveBeenCalledTimes(1);
        const formData = sentFormData();
        expect(formData.get('bio')).toBe('new bio');
        expect(formData.has('social_links')).toBe(false);
    });

    it('says there is nothing to save when nothing changed', async () => {
        const { result } = setup();

        await act(() => result.current.handleSaveProfile());

        expect(authApi.updateProfile).not.toHaveBeenCalled();
        expect(result.current.profileSuccess).toBe('No changes to save');
    });

    it('sends {platform, value} pairs when a link really changed', async () => {
        const { result } = setup();

        act(() => result.current.setSocialLinks([
            { platform: 'twitter', value: 'https://twitter.com/someone' },
            { platform: 'website', value: 'https://example.com' },
        ]));
        await act(() => result.current.handleSaveProfile());

        expect(JSON.parse(sentFormData().get('social_links'))).toEqual([
            { platform: 'twitter', value: 'https://twitter.com/someone' },
            { platform: 'website', value: 'https://example.com' },
        ]);
    });

    it('shows the envelope detail instead of "detail: ..."', async () => {
        authApi.updateProfile.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    detail: 'This username is already taken.',
                    code: 'validation_error',
                    errors: { username: ['This username is already taken.'] },
                },
            },
        });
        const { result } = setup();

        act(() => result.current.setUsername('taken'));
        await act(() => result.current.handleSaveProfile());

        expect(result.current.profileError).toBe('This username is already taken.');
    });
});
