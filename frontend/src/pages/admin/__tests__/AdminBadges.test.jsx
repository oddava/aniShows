import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminBadges from '../AdminBadges';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('../../../api/httpClient', () => ({ default: { get: (...args) => getMock(...args) } }));
vi.mock('../../../api/client', async () => ({
    adminBadgeApi: (await import('../../../api/modules/admin')).adminBadgeApi,
    default: { get: (...args) => getMock(...args) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => ({ userId: 1, isSuperuser: true, isStaff: true }) }));

const badge = { id: 4, name: 'Helper', description: 'Helps', icon: 'star', color: 'violet', priority: 1, holders_count: 0 };

const renderPage = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AdminBadges />
    </QueryClientProvider>,
);

describe('AdminBadges', () => {
    beforeEach(() => {
        getMock.mockReset();
        getMock.mockImplementation((url) => (url.startsWith('/admin/badges/')
            ? Promise.resolve({ data: { results: [badge], count: 1 } })
            : Promise.resolve({ data: { results: [] } })));
    });

    it('searches users once per pause in typing, not per keystroke', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Grant Helper' }, { timeout: 5000 }));
        const input = screen.getByPlaceholderText('Type username...');
        for (const value of ['ka', 'kai', 'kait', 'kaito']) fireEvent.change(input, { target: { value } });

        const userSearches = () => getMock.mock.calls.filter(([url]) => !url.startsWith('/admin/badges/'));
        await waitFor(() => expect(userSearches()).toHaveLength(1), { timeout: 5000 });
        expect(JSON.stringify(userSearches()[0])).toContain('kaito');
    });

    it('shows an error state when the badges fail to load', async () => {
        getMock.mockRejectedValue({ response: { status: 500 } });
        renderPage();
        expect(await screen.findByText('Couldn’t load badges', {}, { timeout: 5000 })).toBeInTheDocument();
        expect(screen.queryByText('No badges found')).toBeNull();
    });
});
