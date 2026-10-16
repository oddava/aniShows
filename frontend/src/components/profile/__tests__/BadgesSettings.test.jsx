import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BadgesSettings from '../BadgesSettings';

let resolveSave;
const updateFeatured = vi.fn(() => new Promise((resolve, reject) => { resolveSave = { resolve, reject }; }));

vi.mock('../../../api/client', () => ({
    badgeApi: {
        getMine: () => Promise.resolve({
            data: [{
                id: 1,
                is_featured: true,
                earned_at: '2026-01-01T00:00:00Z',
                badge: { id: 9, name: 'Pioneer', description: 'Early', icon: 'star', color: 'purple', rarity: 'rare' },
            }],
        }),
        updateFeatured: (...args) => updateFeatured(...args),
    },
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ refreshProfile: vi.fn() }) }));

const renderSettings = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BadgesSettings />
    </QueryClientProvider>,
);

describe('BadgesSettings', () => {
    it('disables saving while a save is in flight and shows a failure', async () => {
        renderSettings();
        const save = await screen.findByRole('button', { name: 'Save Badges' });

        fireEvent.click(save);
        const saving = await screen.findByRole('button', { name: 'Saving...' });
        expect(saving.disabled).toBe(true);

        resolveSave.reject({ response: { data: { detail: 'Too many featured badges.' } } });
        expect(await screen.findByText('Too many featured badges.')).toBeTruthy();
    });
});
