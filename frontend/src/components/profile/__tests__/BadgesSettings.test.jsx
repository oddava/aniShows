import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BadgesSettings from '../BadgesSettings';

let resolveSave;
const updateFeatured = vi.fn(() => new Promise((resolve, reject) => { resolveSave = { resolve, reject }; }));
const mine = vi.hoisted(() => ({ current: [] }));

const userBadge = (id, name, { featured = false, active = true } = {}) => ({
    id,
    is_featured: featured,
    granted_at: '2026-01-01T00:00:00Z',
    badge: { id: id + 100, name, description: `${name} badge`, icon: 'star', color: 'purple', rarity: 'rare', is_active: active },
});

vi.mock('../../../api/client', () => ({
    badgeApi: {
        getMine: () => Promise.resolve({ data: mine.current }),
        updateFeatured: (...args) => updateFeatured(...args),
    },
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ refreshProfile: vi.fn() }) }));

const renderSettings = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BadgesSettings />
    </QueryClientProvider>,
);

beforeEach(() => {
    updateFeatured.mockClear();
    mine.current = [userBadge(1, 'Pioneer', { featured: true })];
});

describe('BadgesSettings', () => {
    it('disables saving while a save is in flight and shows a failure', async () => {
        renderSettings();
        const save = await screen.findByRole('button', { name: 'Save badges' });

        fireEvent.click(save);
        const saving = await screen.findByRole('button', { name: 'Saving...' });
        expect(saving.disabled).toBe(true);

        resolveSave.reject({ response: { data: { detail: 'Too many featured badges.' } } });
        expect(await screen.findByText('Too many featured badges.')).toBeTruthy();
        // One message, not the server detail plus a generic duplicate.
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('explains retired badges and does not let them be featured', async () => {
        mine.current = [
            userBadge(1, 'Pioneer'),
            // A stale featured flag on a retired badge must not count toward the 3.
            userBadge(2, 'Beta Tester', { featured: true, active: false }),
        ];
        renderSettings();

        const retired = await screen.findByRole('checkbox', { name: 'Feature Beta Tester' });
        expect(retired).toHaveAttribute('aria-disabled', 'true');
        expect(retired).toHaveAttribute('aria-checked', 'false');
        expect(retired).toHaveAccessibleDescription("This badge is retired and can't be featured.");
        expect(screen.getByText('(0/3 selected)')).toBeTruthy();

        fireEvent.click(retired);
        expect(retired).toHaveAttribute('aria-checked', 'false');

        const active = screen.getByRole('checkbox', { name: 'Feature Pioneer' });
        fireEvent.keyDown(active, { key: ' ' });
        expect(active).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Save badges' }));
        await waitFor(() => expect(updateFeatured).toHaveBeenCalledWith([1]));
    });

    it('caps featuring at 3: a 4th badge is disabled', async () => {
        mine.current = [
            userBadge(1, 'One', { featured: true }),
            userBadge(2, 'Two', { featured: true }),
            userBadge(3, 'Three', { featured: true }),
            userBadge(4, 'Four'),
        ];
        renderSettings();

        const fourth = await screen.findByRole('checkbox', { name: 'Feature Four' });
        expect(fourth).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(fourth);
        expect(fourth).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('(3/3 selected)')).toBeTruthy();
    });
});
