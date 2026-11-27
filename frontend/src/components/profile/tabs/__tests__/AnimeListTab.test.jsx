import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import AnimeListTab from '../AnimeListTab';

const listApi = vi.hoisted(() => ({ getAll: vi.fn(), summary: vi.fn() }));
const increment = vi.hoisted(() => vi.fn());

vi.mock('../../../../api/client', () => ({ listApi, activityApi: {}, reviewApi: {} }));
vi.mock('../../../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 7, username: 'kiyo' } }),
}));
vi.mock('../../../AnimeCard', () => ({
    default: ({ anime }) => <div data-testid="anime-card">{anime.title}</div>,
    AnimeCardSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('../../../../hooks/useListEntryMutation', () => ({
    default: ({ entry }) => ({ entry, increment, isPending: false }),
}));

const row = (id) => ({
    id,
    score: 0,
    episodes_watched: 2,
    anime: { id: 100 + id, slug: `anime-${id}`, title: `Anime ${id}`, episode_count: 12 },
});

const page = (ids, { next = null, count = 120 } = {}) => ({ data: { count, next, previous: null, results: ids.map(row) } });

function Harness({ initialView = 'grid', ...props }) {
    const [status, setStatus] = useState('Watching');
    const [search, setSearch] = useState('');
    const [view, setView] = useState(initialView);
    return (
        <AnimeListTab
            listStatusFilter={status}
            setListStatusFilter={setStatus}
            searchQuery={search}
            setSearchQuery={setSearch}
            viewMode={view}
            setViewMode={setView}
            currentListData={[]}
            listsLoading={false}
            listsFetching={false}
            {...props}
        />
    );
}

function renderTab(props = {}, path = '/profile/anime_list') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/profile/*" element={<Harness {...props} />} />
                    <Route path="/u/:username/*" element={<Harness {...props} />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

const EMOJI = /\p{Extended_Pictographic}/u;

beforeEach(() => {
    listApi.getAll.mockReset();
    listApi.summary.mockReset();
    increment.mockReset();
    listApi.summary.mockResolvedValue({
        data: { counts: { Watching: 120, Completed: 4, 'Plan to Watch': 0, 'On Hold': 1, Dropped: 0 }, total: 125 },
    });
});

describe('AnimeListTab', () => {
    it('loads the first page of 50 for the signed-in user and shows the count from the API', async () => {
        listApi.getAll.mockResolvedValue(page([1, 2], { next: 'http://x/api/v1/lists/?page=2' }));
        renderTab({ isPublicView: false });

        expect(await screen.findByText('120 in Watching')).toBeInTheDocument();
        expect(listApi.getAll).toHaveBeenCalledWith({
            username: 'kiyo', status: 'Watching', ordering: '-updated_at', page: 1, page_size: 50,
        });
        expect(listApi.summary).toHaveBeenCalledWith({ username: 'kiyo' });
    });

    it('loads the next page with Load more', async () => {
        listApi.getAll
            .mockResolvedValueOnce(page([1, 2], { next: 'http://x/api/v1/lists/?page=2' }))
            .mockResolvedValueOnce(page([3]));
        renderTab({ isPublicView: false });

        // The first page must render before Load more exists; under a loaded full run
        // that takes longer than findBy's 1 s default.
        await screen.findByText('Anime 2', {}, { timeout: 5000 });
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(await screen.findByText('Anime 3', {}, { timeout: 5000 })).toBeInTheDocument();
        expect(listApi.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 50 }));
        expect(screen.getAllByTestId('anime-card')).toHaveLength(3);
        expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    it('searches on the server after the user stops typing', async () => {
        listApi.getAll.mockResolvedValue(page([1]));
        renderTab({ isPublicView: false });
        await screen.findByText('Anime 1');

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search in Watching' }), { target: { value: ' frieren ' } });

        await waitFor(() => expect(listApi.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'frieren', page: 1 })));
    });

    it('reads a public list from the URL and shows plain-text tabs with counts', async () => {
        listApi.getAll.mockResolvedValue(page([1]));
        renderTab({ isPublicView: true }, '/u/mio/anime_list');

        await screen.findByText('Anime 1');
        expect(listApi.getAll).toHaveBeenCalledWith(expect.objectContaining({ username: 'mio' }));

        const watchingTab = screen.getByRole('button', { name: /^Watching/ });
        expect(watchingTab).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(watchingTab).toHaveTextContent('Watching120'));
        // Statuses with nothing in them have no tab (like My list).
        ['Planning', 'Dropped'].forEach((label) => {
            expect(screen.queryByRole('button', { name: new RegExp(`^${label}`) })).not.toBeInTheDocument();
        });
        ['Completed', 'On hold'].forEach((label) => {
            const tab = screen.getByRole('button', { name: new RegExp(`^${label}`) });
            expect(tab).toHaveAttribute('aria-pressed', 'false');
            expect(tab.textContent).not.toMatch(EMOJI);
        });
        expect(watchingTab.textContent).not.toMatch(EMOJI);
    });

    it('keeps Watching and the status in view even when they are empty', async () => {
        listApi.summary.mockResolvedValue({
            data: { counts: { Watching: 0, Completed: 3, 'Plan to Watch': 0, 'On Hold': 0, Dropped: 0 }, total: 3 },
        });
        listApi.getAll.mockResolvedValue(page([], { count: 0 }));
        renderTab({ isPublicView: true }, '/u/mio/anime_list');

        await waitFor(() => expect(screen.getByRole('button', { name: /^Completed/ })).toHaveTextContent('Completed3'));
        expect(screen.getByRole('button', { name: /^Watching/ })).toHaveTextContent('Watching0');
        expect(screen.queryByRole('button', { name: /^On hold/ })).not.toBeInTheDocument();
    });

    it('switching status refetches that status', async () => {
        listApi.getAll.mockResolvedValue(page([1]));
        renderTab({ isPublicView: false });
        await screen.findByText('Anime 1');

        fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));

        await waitFor(() => expect(listApi.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'Completed' })));
    });

    it('offers an inline +1 in list view on the own profile only', async () => {
        listApi.getAll.mockResolvedValue(page([1]));
        const { unmount } = renderTab({ isPublicView: false, initialView: 'list' });

        fireEvent.click(await screen.findByRole('button', { name: '+1 episode: Anime 1' }));
        expect(increment).toHaveBeenCalledTimes(1);
        expect(screen.getByText('2/12')).toBeInTheDocument();
        unmount();

        renderTab({ isPublicView: true, initialView: 'list' }, '/u/mio/anime_list');
        await screen.findByText('Anime 1');
        expect(screen.queryByRole('button', { name: /^\+1 episode/ })).not.toBeInTheDocument();
    });
});
