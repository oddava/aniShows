import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Profile from '../Profile';

const api = vi.hoisted(() => ({
    authApi: { getByUsername: vi.fn(), getProfile: vi.fn() },
    favoriteApi: { getAll: vi.fn() },
    reviewApi: { getAll: vi.fn() },
    listApi: { getAll: vi.fn() },
}));

vi.mock('../../api/client', () => api);
vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { username: 'viewer' }, isAuthenticated: true, loading: false }),
}));
vi.mock('../../hooks/useUserProfile', () => ({ default: () => ({ data: null }) }));
vi.mock('../../components/FollowersModal', () => ({ default: () => null }));
vi.mock('../../components/profile/OverviewTab', () => ({ default: () => <div>overview</div> }));
vi.mock('../../components/profile', () => ({
    ProfileErrorBoundary: ({ children }) => children,
    ProfileHeader: ({ displayUser }) => <h1>{displayUser.username}</h1>,
    ProfileTabs: ({ activeTab }) => <div data-testid="active-tab">{activeTab}</div>,
    ProfileContent: () => <div>content</div>,
}));

function Where() {
    const location = useLocation();
    return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

const renderAt = (entry) => {
    const client = new QueryClient();
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[entry]}>
                <Routes>
                    <Route path="/u/:username/*" element={<Profile />} />
                </Routes>
                <Where />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
};

describe('Profile canonical username', () => {
    beforeEach(() => vi.clearAllMocks());

    it('swaps the URL to the canonical case and keeps the tab and query', async () => {
        api.authApi.getByUsername.mockResolvedValue({ data: { username: 'SomeOne', is_private: false } });
        api.reviewApi.getAll.mockResolvedValue({ data: { results: [], next: null } });
        renderAt('/u/someone/reviews?sort=new');

        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/u/SomeOne/reviews?sort=new'));
        expect(screen.getByTestId('active-tab')).toHaveTextContent('reviews');
        // The cache was seeded under the canonical key, so no second profile fetch.
        expect(api.authApi.getByUsername).toHaveBeenCalledTimes(1);
    });

    it('leaves a URL that already matches alone', async () => {
        api.authApi.getByUsername.mockResolvedValue({ data: { username: 'someone', is_private: false } });
        renderAt('/u/someone');

        expect(await screen.findByRole('heading', { name: 'someone' })).toBeInTheDocument();
        expect(screen.getByTestId('where')).toHaveTextContent('/u/someone');
    });

    it('does not retry a missing profile', async () => {
        api.authApi.getByUsername.mockRejectedValue({ response: { status: 404 } });
        renderAt('/u/ghost');

        expect(await screen.findByText('User not found')).toBeInTheDocument();
        expect(api.authApi.getByUsername).toHaveBeenCalledTimes(1);
    });
});
