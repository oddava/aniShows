import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import DraggableFavoritesGrid from '../DraggableFavoritesGrid';
import FavoritesTab from '../profile/tabs/FavoritesTab';

const favoriteApi = vi.hoisted(() => ({ reorder: vi.fn(), getAll: vi.fn() }));

vi.mock('../../api/client', () => ({ favoriteApi, followApi: {} }));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../AnimeCard', () => ({
    default: ({ anime }) => <a href={`/anime/${anime.slug}`} data-testid="card">{anime.title}</a>,
    AnimeCardSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('../../sentry', () => ({ captureException: vi.fn() }));

const favorites = [
    { id: 11, anime: { id: 1, slug: 'frieren', title: 'Frieren' } },
    { id: 12, anime: { id: 2, slug: 'mushishi', title: 'Mushishi' } },
    { id: 13, anime: { id: 3, slug: 'monster', title: 'Monster' } },
];

const cardOrder = () => screen.getAllByTestId('card').map((node) => node.textContent);

const renderGrid = (props = {}) => render(
    <DraggableFavoritesGrid favorites={favorites} isOwnProfile reorderMode onDone={vi.fn()} {...props} />,
);

beforeEach(() => {
    favoriteApi.reorder.mockReset();
    favoriteApi.getAll.mockReset();
});

describe('DraggableFavoritesGrid reorder mode', () => {
    it('moves a card with the arrow keys on its handle and saves the full id list', async () => {
        favoriteApi.reorder.mockResolvedValue({ data: { message: 'ok', count: 3 } });
        renderGrid();

        const handle = screen.getByRole('button', { name: /Reorder Frieren, position 1 of 3/ });
        handle.focus();
        fireEvent.keyDown(handle, { key: 'ArrowRight' });

        expect(cardOrder()).toEqual(['Mushishi', 'Frieren', 'Monster']);
        expect(favoriteApi.reorder).toHaveBeenCalledTimes(1);
        expect(favoriteApi.reorder).toHaveBeenCalledWith([12, 11, 13]);
        // Focus follows the moved card's handle.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /Reorder Frieren, position 2 of 3/ }));
        expect(await screen.findByText('Order saved.')).toBeTruthy();
    });

    it('has Move earlier / Move later buttons that work without a keyboard', async () => {
        favoriteApi.reorder.mockResolvedValue({ data: {} });
        renderGrid();

        expect(screen.getByRole('button', { name: 'Move Frieren earlier' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move Monster later' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Move Monster earlier' }));

        expect(cardOrder()).toEqual(['Frieren', 'Monster', 'Mushishi']);
        expect(favoriteApi.reorder).toHaveBeenCalledWith([11, 13, 12]);
        await screen.findByText('Order saved.');
    });

    it('sends one request at a time and saves the latest order last', async () => {
        let resolveFirst;
        favoriteApi.reorder
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValue({ data: {} });
        renderGrid();

        const handle = screen.getByRole('button', { name: /Reorder Frieren/ });
        fireEvent.keyDown(handle, { key: 'ArrowRight' });
        fireEvent.keyDown(screen.getByRole('button', { name: /Reorder Frieren/ }), { key: 'ArrowRight' });
        expect(favoriteApi.reorder).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();

        await act(async () => resolveFirst({ data: {} }));

        await waitFor(() => expect(favoriteApi.reorder).toHaveBeenCalledTimes(2));
        expect(favoriteApi.reorder).toHaveBeenLastCalledWith([12, 13, 11]);
        await screen.findByText('Order saved.');
        expect(screen.getByRole('button', { name: 'Done' })).not.toBeDisabled();
    });

    it('reverts and shows the server message when the save fails', async () => {
        favoriteApi.reorder.mockRejectedValue({
            response: { status: 400, data: { detail: 'Unknown favorite ids: 99.', code: 'invalid' } },
        });
        renderGrid();

        fireEvent.keyDown(screen.getByRole('button', { name: /Reorder Frieren/ }), { key: 'ArrowDown' });

        const alert = await screen.findByRole('alert');
        expect(within(alert).getByText('Unknown favorite ids: 99.')).toBeTruthy();
        expect(cardOrder()).toEqual(['Frieren', 'Mushishi', 'Monster']);
    });

    it('shows the throttle copy on 429', async () => {
        favoriteApi.reorder.mockRejectedValue({ response: { status: 429, data: { detail: 'Request was throttled.', code: 'throttled' } } });
        renderGrid();

        fireEvent.click(screen.getByRole('button', { name: 'Move Frieren later' }));

        expect(await screen.findByText('You are doing that too fast. Please wait a moment.')).toBeTruthy();
    });

    it('calls onDone from the Done button', () => {
        const onDone = vi.fn();
        renderGrid({ onDone });
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalled();
    });
});

describe('DraggableFavoritesGrid outside reorder mode', () => {
    it('renders plain cards with no reorder controls or drag', () => {
        render(<DraggableFavoritesGrid favorites={favorites} isOwnProfile />);

        expect(cardOrder()).toEqual(['Frieren', 'Mushishi', 'Monster']);
        expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Move/ })).toBeNull();
        expect(document.querySelector('[draggable="true"]')).toBeNull();
    });

    it('never shows reorder controls on someone else\'s profile', () => {
        render(<DraggableFavoritesGrid favorites={favorites} isOwnProfile={false} reorderMode />);
        expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
    });
});

describe('FavoritesTab reorder toggle', () => {
    const page = (results, count, next = null) => ({ data: { results, count, next, previous: null } });

    const renderTab = () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <FavoritesTab
                        favoritesData={{ pages: [{ results: favorites.slice(0, 2), count: 3, next: 'http://x/api/favorites/?page=2' }] }}
                        favoritesLoading={false}
                        hasNextFavorites
                        isFetchingNextFavorites={false}
                        fetchNextFavorites={vi.fn()}
                        isOwnProfile
                        targetUsername="kiyo"
                        isPublicView={false}
                    />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        return { invalidate };
    };

    it('loads every favorite (page_size 200, following next) and reloads the grid on Done', async () => {
        favoriteApi.getAll
            .mockResolvedValueOnce(page(favorites.slice(0, 2), 3, 'http://x/api/favorites/?page=2&page_size=200&username=kiyo'))
            .mockResolvedValueOnce(page(favorites.slice(2), 3));
        favoriteApi.reorder.mockResolvedValue({ data: {} });
        const { invalidate } = renderTab();

        fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));

        await screen.findByRole('button', { name: /Reorder Monster, position 3 of 3/ });
        expect(favoriteApi.getAll).toHaveBeenNthCalledWith(1, { username: 'kiyo', page: 1, page_size: 200 });
        expect(favoriteApi.getAll).toHaveBeenNthCalledWith(2, { username: 'kiyo', page: 2, page_size: 200 });
        expect(screen.queryByRole('button', { name: 'Load More Favorites' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Move Monster earlier' }));
        expect(favoriteApi.reorder).toHaveBeenCalledWith([11, 13, 12]);
        await screen.findByText('Order saved.');

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        const keys = invalidate.mock.calls.map(([arg]) => arg.queryKey);
        expect(keys).toContainEqual(['favorites', 'kiyo']);
        expect(keys).toContainEqual(['favorites-overview', 'kiyo']);
        expect(screen.getByRole('button', { name: 'Reorder' })).toBeTruthy();
    });
});
