import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import Analytics from '../Analytics';
import { SUPERUSER, currentLocation, installResizeObserver, renderPage } from './opsTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: null },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const OVERVIEW = {
    users: { total: 1200, growth: 12.5, new: 40, new_growth: 5, active: 300, active_growth: -4, retention: 62.5, retention_change: 1.5, growth_by_day: [], daily_signups: [] },
    content: { anime_total: 67, episodes_total: 900, studios_total: 20, genres_total: 18 },
    engagement: { favorites: 50, favorites_growth: 0, reviews: 20, reviews_growth: 10, watchlists: 400, watchlists_growth: 3, avg_rating: 7.4 },
    recent_activity: [{ type: 'SUSPEND', text: 'root suspend User #9', time: new Date().toISOString() }],
};

const USERS = {
    total_users: 1200,
    new_users: 40,
    returning_users: 200,
    active_users_count: 300,
    user_breakdown: { active: 1190, inactive: 10, verified: 1000, unverified: 200, staff: 3 },
    registration_trend: [],
    active_users: [{ id: 4, username: 'busy_bee', list_entries: 12, reviews: 2, favorites: 1 }],
};

describe('Analytics', () => {
    beforeEach(() => {
        installResizeObserver();
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = SUPERUSER;
        api.get.mockImplementation((path, params) => {
            if (path === 'reports') return Promise.resolve(params.type === 'users' ? USERS : OVERVIEW);
            if (path === 'stats/export') return Promise.resolve({ users: { total: 1200 } });
            return Promise.reject(new Error(path));
        });
    });

    it('renders the overview with growth', async () => {
        renderPage(<Analytics />, { path: '/admin/analytics' });
        expect(await screen.findByText('+12.5%')).toBeInTheDocument();
        expect(screen.getByText('root suspend User #9')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('reports', { type: 'overview', days: '30' }, expect.anything());
    });

    it('switches report and period through the URL', async () => {
        renderPage(<Analytics />, { path: '/admin/analytics' });
        await screen.findByText('+12.5%');
        fireEvent.click(screen.getByRole('tab', { name: 'Users' }));
        expect(await screen.findByText('busy_bee')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Period'), { target: { value: '90' } });
        await waitFor(() => expect(api.get).toHaveBeenCalledWith('reports', { type: 'users', days: '90' }, expect.anything()));
        expect(currentLocation().search).toBe('?tab=users&days=90');
    });

    it('downloads the stats export', async () => {
        const createObjectURL = vi.fn(() => 'blob:stats');
        globalThis.URL.createObjectURL = createObjectURL;
        globalThis.URL.revokeObjectURL = vi.fn();
        renderPage(<Analytics />, { path: '/admin/analytics' });
        await screen.findByText('+12.5%');
        fireEvent.click(screen.getByRole('button', { name: 'Download stats' }));
        await waitFor(() => expect(api.get).toHaveBeenCalledWith('stats/export'));
        await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    });
});
