import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import Logs, { diffRows } from '../Logs';
import { STAFF, SUPERUSER, renderPage } from './opsTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: null },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const AUDIT = {
    id: 31,
    timestamp: new Date().toISOString(),
    user: 1,
    username: 'root',
    user_ip: '10.0.0.1',
    action: 'SUSPEND',
    entity_type: 'User',
    entity_id: '9',
    entity_repr: 'spammer',
    previous_state: { is_active: true },
    new_state: { is_active: false },
    changes: {},
    metadata: { reason: 'Spam links in every review' },
};

const REQUEST = {
    id: 3,
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    log_type: 'REQUEST',
    method: 'GET',
    path: '/api/v1/anime/broken/',
    status_code: 500,
    message: 'Server error',
    duration_ms: 812,
    user: null,
    username: null,
    details: {},
};

const routeGet = (path) => {
    if (path === 'audit-logs') return Promise.resolve({ count: 1, results: [AUDIT] });
    if (path === 'logs') return Promise.resolve({ count: 1, results: [REQUEST] });
    if (path === 'logs/stats') return Promise.resolve({ by_level: { ERROR: 1 }, total: 1, window: '24h', recent_errors: 1, error_rate: 100 });
    return Promise.reject(new Error(`unexpected ${path}`));
};

describe('Logs', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        api.get.mockImplementation(routeGet);
    });

    it('shows staff the audit log only', async () => {
        auth.user = STAFF;
        renderPage(<Logs />, { path: '/admin/logs?tab=requests' });
        expect(await screen.findByText('spammer')).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Request logs' })).toBeNull();
        expect(api.get).not.toHaveBeenCalledWith('logs', expect.anything(), expect.anything());
    });

    it('opens an audit entry with its reason and before/after', async () => {
        auth.user = SUPERUSER;
        renderPage(<Logs />, { path: '/admin/logs?open=31' });
        const drawer = await screen.findByRole('dialog', { name: 'Suspend user' });
        expect(within(drawer).getByText('Spam links in every review')).toBeInTheDocument();
        const row = within(drawer).getByRole('row', { name: /is_active/ });
        expect(within(row).getByText('true')).toBeInTheDocument();
        expect(within(row).getByText('false')).toBeInTheDocument();
    });

    it('gives superusers the request logs with a stats strip', async () => {
        auth.user = SUPERUSER;
        renderPage(<Logs />, { path: '/admin/logs?tab=requests' });
        expect(await screen.findByText('/api/v1/anime/broken/')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Request logs' })).toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByText(/errors today/)).toBeInTheDocument();
    });

    it('builds diff rows from previous and new state', () => {
        expect(diffRows(AUDIT)).toEqual([{ key: 'is_active', before: true, after: false }]);
    });
});
