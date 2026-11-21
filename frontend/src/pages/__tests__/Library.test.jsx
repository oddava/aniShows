import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { listRoutes } from '../../app/routes/lists';
import { listApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    listApi: { getAll: vi.fn(), summary: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() },
    activityApi: {},
    reviewApi: {},
    authApi: {},
    animeApi: {},
}));

const auth = vi.hoisted(() => ({ value: { isAuthenticated: true, loading: false, user: { id: 1, username: 'megumin' } } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth.value }));

const onePiece = {
    id: 51, slug: 'one-piece', title: 'One Piece', anime_type: 'TV', episode_count: 0, next_airing_episode: 1181,
};
const frieren = { id: 5, slug: 'frieren', title: 'Frieren', anime_type: 'TV', episode_count: 28 };

// The route is lazy-loaded; under a full parallel run the first paint can take >1 s.
configure({ asyncUtilTimeout: 4000 });

const page = (...results) => ({ data: { count: results.length, next: null, results } });

function renderAt(path) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <HelmetProvider>
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[path]}>
                    <Routes>
                        {listRoutes}
                        <Route path="login" element={<p>Sign in page</p>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </HelmetProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    auth.value = { isAuthenticated: true, loading: false, user: { id: 1, username: 'megumin' } };
    globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
    try { localStorage.clear(); } catch { /* ignore */ }
    listApi.summary.mockResolvedValue({
        data: { counts: { Watching: 1, Completed: 1, 'Plan to Watch': 0, 'On Hold': 0, Dropped: 0 }, total: 2, episodes_watched: 41 },
    });
});

describe('/list library (P2)', () => {
    it('is a real page that opens on Watching, with counts per status', async () => {
        listApi.getAll.mockResolvedValue(page({ id: 1, status: 'Watching', episodes_watched: 13, score: 0, anime: onePiece }));
        renderAt('/list');

        expect(await screen.findByRole('heading', { name: 'My list' })).toBeInTheDocument();
        await waitFor(() => expect(listApi.getAll).toHaveBeenCalledWith(expect.objectContaining({ username: 'megumin', status: 'Watching' })));
        expect(await screen.findByRole('group', { name: 'Episodes watched of One Piece' })).toHaveTextContent('13 / 1180 aired');
        const tabs = screen.getByRole('navigation', { name: 'List status' });
        expect(within(tabs).getByRole('button', { name: /Watching\s*1/ })).toHaveAttribute('aria-current', 'page');
        expect(within(tabs).getByRole('button', { name: /All\s*2/ })).toBeInTheDocument();
        expect(within(tabs).getByRole('button', { name: /Completed\s*1/ })).toBeInTheDocument();
        // Empty statuses are left out of the strip.
        expect(within(tabs).queryByRole('button', { name: /Planning/ })).not.toBeInTheDocument();
    });

    it('has a dense table view with inline score editing (T2, T4)', async () => {
        listApi.getAll.mockResolvedValue(page({ id: 2, status: 'Completed', episodes_watched: 28, score: 0, anime: frieren }));
        listApi.update.mockResolvedValue({ data: { id: 2, status: 'Completed', episodes_watched: 28, score: 9 } });
        renderAt('/list?status=completed');

        fireEvent.click(await screen.findByRole('button', { name: 'Table view' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Score Frieren' }));
        fireEvent.click(screen.getByRole('radio', { name: '9 out of 10' }));

        await waitFor(() => expect(listApi.update).toHaveBeenCalledWith(2, { score: 9 }));
        expect(await screen.findByRole('button', { name: 'Your score for Frieren: 9. Change' })).toBeInTheDocument();
    });

    it('keeps a show that just moved to Completed in place, so its score prompt stays open', async () => {
        const watching = { id: 3, status: 'Watching', episodes_watched: 11, score: 0, anime: frieren };
        listApi.getAll
            .mockResolvedValueOnce(page(watching))
            .mockResolvedValue(page());
        listApi.update.mockResolvedValue({ data: { id: 3, status: 'Completed', episodes_watched: 28, score: 0 } });
        renderAt('/list');

        fireEvent.click(await screen.findByRole('button', { name: 'Watching. Change list status for Frieren' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Completed' }));

        // The list refetches without it, but the card and its score row stay.
        await waitFor(() => expect(listApi.getAll.mock.calls.length).toBeGreaterThan(1));
        expect(await screen.findByRole('radiogroup', { name: 'Score this anime' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Completed\. Change list status for Frieren/ })).toBeInTheDocument();
    });

    it('says what to do when a status is empty', async () => {
        listApi.getAll.mockResolvedValue(page());
        renderAt('/list?status=planning');
        expect(await screen.findByText('Your plan is empty')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Browse anime' })).toHaveAttribute('href', '/browse');
    });

    it('sends guests to sign in', () => {
        auth.value = { isAuthenticated: false, loading: false, user: null };
        renderAt('/list');
        expect(screen.getByText('Sign in page')).toBeInTheDocument();
    });
});
