import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminLogs from '../AdminLogs';

const { getMock, role } = vi.hoisted(() => ({
    getMock: vi.fn(),
    role: { userId: 1, isSuperuser: true, isStaff: true },
}));

vi.mock('../../../api/client', () => ({ default: { get: (...args) => getMock(...args) } }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => role }));

const log = {
    id: 1, level: 'ERROR', log_type: 'REQUEST', message: 'GET /api/v1/x - 500', method: 'GET', path: '/api/v1/x',
    status_code: 500, timestamp: '2026-11-15T10:00:00Z', details: { user_agent: 'curl/8' },
};
const audit = {
    id: 5, action: 'SUSPEND', entity_type: 'User', entity_id: '12', entity_repr: 'kaito', username: 'mod',
    timestamp: '2026-11-15T10:00:00Z', changes: {}, metadata: { reason: 'Spam links' },
};

const renderAt = (url) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[url]}>
                <AdminLogs />
            </MemoryRouter>
        </QueryClientProvider>,
    );
};

describe('AdminLogs', () => {
    beforeEach(() => {
        role.isSuperuser = true;
        getMock.mockReset();
        getMock.mockImplementation((url) => {
            if (url.startsWith('/admin/logs/stats/')) return Promise.resolve({ data: { by_level: { ERROR: 1 }, total: 1, window: '24h' } });
            if (url.startsWith('/admin/logs/')) return Promise.resolve({ data: { results: [log], count: 1 } });
            if (url.startsWith('/admin/audit-logs/')) return Promise.resolve({ data: { results: [audit], count: 1 } });
            return Promise.reject(new Error(url));
        });
    });

    it('does not poll until Live is switched on, and shows details JSON', async () => {
        renderAt('/admin/logs');
        expect(await screen.findByText('GET /api/v1/x - 500')).toBeInTheDocument();
        const live = screen.getByRole('checkbox', { name: /Live/ });
        expect(live).not.toBeChecked();
        expect(screen.getByText('Live updates off')).toBeInTheDocument();

        fireEvent.click(live);
        expect(screen.getByText('Live updates on')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Details' }));
        const dialog = screen.getByRole('dialog', { name: 'Log details' });
        expect(within(dialog).getByText(/"user_agent": "curl\/8"/)).toBeInTheDocument();
    });

    it('gives staff only the Audit tab, prefilled from the link', async () => {
        role.isSuperuser = false;
        renderAt('/admin/logs?tab=audit&entity_type=User&entity_id=12');

        expect(await screen.findByText(/Reason: Spam links/)).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Requests' })).toBeNull();
        expect(getMock.mock.calls.some(([url]) => url.startsWith('/admin/logs/'))).toBe(false);
        await waitFor(() => {
            const url = getMock.mock.calls.at(-1)[0];
            expect(url).toContain('entity_type=User');
            expect(url).toContain('entity_id=12');
        });
        expect(screen.getByText('Showing entries for User #12')).toBeInTheDocument();
    });
});
