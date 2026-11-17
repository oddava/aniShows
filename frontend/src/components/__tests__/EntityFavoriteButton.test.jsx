import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import EntityFavoriteButton from '../common/EntityFavoriteButton';
import { useToggleFavorite } from '../../api/queries/favorites';

const apis = vi.hoisted(() => ({
    favoriteApi: { toggle: vi.fn() },
    characterFavoriteApi: { toggle: vi.fn() },
    staffFavoriteApi: { toggle: vi.fn() },
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../api/client', () => ({ ...apis, followApi: {} }));
vi.mock('react-hot-toast', () => ({ default: toast }));

const renderButton = (props = {}) => render(
    <MemoryRouter>
        <EntityFavoriteButton isAuthenticated isFavorite={false} favoriteCount={1234} onToggle={vi.fn()} entityLabel="Frieren" {...props} />
    </MemoryRouter>,
);

describe('EntityFavoriteButton', () => {
    it('is named for its action, carries aria-pressed and keeps the count visible', () => {
        renderButton();
        const button = screen.getByRole('button', { name: 'Favorite Frieren' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(button).toHaveTextContent('1.2K');
        expect(button).toHaveAccessibleDescription('1.2K');
    });

    it('says Unfavorite and is pressed when favorited', () => {
        renderButton({ isFavorite: true });
        const button = screen.getByRole('button', { name: 'Unfavorite Frieren' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('calls onToggle and is disabled while pending', () => {
        const onToggle = vi.fn();
        const { rerender } = renderButton({ onToggle });
        fireEvent.click(screen.getByRole('button', { name: 'Favorite Frieren' }));
        expect(onToggle).toHaveBeenCalledTimes(1);

        rerender(
            <MemoryRouter>
                <EntityFavoriteButton isAuthenticated isFavorite={false} favoriteCount={1234} onToggle={onToggle} entityLabel="Frieren" isPending />
            </MemoryRouter>,
        );
        expect(screen.getByRole('button', { name: 'Favorite Frieren' })).toBeDisabled();
    });

    it('links signed-out viewers to login', () => {
        renderButton({ isAuthenticated: false, favoriteCount: 0 });
        const link = screen.getByRole('link', { name: 'Sign in to favorite Frieren, 0 favorites' });
        expect(link).toHaveAttribute('href', '/login');
        expect(link).toHaveTextContent('0');
    });
});

describe('useToggleFavorite', () => {
    const setup = (kind) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const hook = renderHook(() => useToggleFavorite(kind), { wrapper });
        return { ...hook, keys: () => invalidate.mock.calls.map(([arg]) => arg.queryKey) };
    };

    it('toggles a character favorite and invalidates character favorite lists', async () => {
        apis.characterFavoriteApi.toggle.mockResolvedValue({ data: { is_favorite: true, favorite_count: 3, message: 'ok' } });
        const { result, keys } = setup('character');

        let data;
        await act(async () => { data = await result.current.mutateAsync(9); });

        expect(apis.characterFavoriteApi.toggle).toHaveBeenCalledWith(9);
        expect(data).toEqual({ is_favorite: true, favorite_count: 3, message: 'ok' });
        expect(keys()).toEqual([['character-favorites']]);
    });

    it('toasts the throttle copy on 429', async () => {
        apis.favoriteApi.toggle.mockRejectedValue({ response: { status: 429, data: { detail: 'x', code: 'throttled' } } });
        const { result } = setup('anime');

        await act(async () => { await result.current.mutateAsync(1).catch(() => {}); });

        expect(toast.error).toHaveBeenCalledWith('You are doing that too fast. Please wait a moment.');
    });
});
