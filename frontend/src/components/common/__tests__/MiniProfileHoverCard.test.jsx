import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import MiniProfileHoverCard from '../MiniProfileHoverCard';

const api = vi.hoisted(() => ({
    authApi: { getByUsername: vi.fn(), getProfile: vi.fn() },
    listApi: { getAll: vi.fn() },
    favoriteApi: { getAll: vi.fn() },
}));

vi.mock('../../../api/client', () => api);
vi.mock('../../FollowButton', () => ({ default: () => null }));
vi.mock('../AnimeMediaImage', () => ({ default: () => null }));

const originalMatchMedia = window.matchMedia;

const renderCard = () => {
    const client = new QueryClient();
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <MiniProfileHoverCard username="someone">
                    <span>someone</span>
                </MiniProfileHoverCard>
            </MemoryRouter>
        </QueryClientProvider>,
    );
};

describe('MiniProfileHoverCard requests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.matchMedia = vi.fn().mockReturnValue({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        api.listApi.getAll.mockResolvedValue({ data: { results: [] } });
        api.favoriteApi.getAll.mockResolvedValue({ data: { results: [] } });
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    it('fetches watching and favorites only after a public profile resolves', async () => {
        let resolveProfile;
        api.authApi.getByUsername.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
        renderCard();

        fireEvent.mouseEnter(screen.getByText('someone').parentElement);
        await waitFor(() => expect(api.authApi.getByUsername).toHaveBeenCalledWith('someone'));
        expect(api.listApi.getAll).not.toHaveBeenCalled();
        expect(api.favoriteApi.getAll).not.toHaveBeenCalled();

        resolveProfile({ data: { username: 'someone', is_private: false } });

        await waitFor(() => expect(api.listApi.getAll).toHaveBeenCalledTimes(1));
        expect(api.favoriteApi.getAll).toHaveBeenCalledTimes(1);
    });

    it('skips watching and favorites for a private profile', async () => {
        api.authApi.getByUsername.mockResolvedValue({ data: { username: 'someone', is_private: true } });
        renderCard();

        fireEvent.mouseEnter(screen.getByText('someone').parentElement);

        expect(await screen.findByText('This profile is private.')).toBeInTheDocument();
        expect(api.listApi.getAll).not.toHaveBeenCalled();
        expect(api.favoriteApi.getAll).not.toHaveBeenCalled();
    });

    it('does not retry a 404 and skips the other requests', async () => {
        api.authApi.getByUsername.mockRejectedValue({ response: { status: 404 } });
        renderCard();

        fireEvent.mouseEnter(screen.getByText('someone').parentElement);

        expect(await screen.findByText('Could not load profile preview.')).toBeInTheDocument();
        expect(api.authApi.getByUsername).toHaveBeenCalledTimes(1);
        expect(api.listApi.getAll).not.toHaveBeenCalled();
        expect(api.favoriteApi.getAll).not.toHaveBeenCalled();
    });
});
