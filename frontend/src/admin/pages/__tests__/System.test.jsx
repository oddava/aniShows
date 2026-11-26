import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import System from '../System';
import { STAFF, SUPERUSER, installResizeObserver, renderPage } from './opsTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: null },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const PAYLOAD = {
    generated_at: new Date().toISOString(),
    can_run: true,
    health: { database: true, cache: true, migrations_pending: false },
    queues: { available: true, items: [{ name: 'default', size: 3 }, { name: 'batch', size: 240 }] },
    workers: { available: true, total: 1, items: [{ name: 'celery@worker-1', active_tasks: 2 }] },
    beat: [
        {
            name: 'refresh-trending',
            task: 'apps.animes.tasks.catalog.run_catalog_lane',
            kwargs: { lane: 'trending' },
            schedule: 'every 6 hours',
            queue: 'default',
            last_run: new Date(Date.now() - 3600_000).toISOString(),
            next_due: new Date(Date.now() + 3600_000).toISOString(),
            stale: false,
            tracked: true,
        },
    ],
    anilist: { available: true, limit: 90, used_this_minute: 12, interactive_used: 2, paused_until: null, breaker: { state: 'closed' } },
    database: { available: true, size_bytes: 52_428_800, tables: [{ name: 'anime_anime', size_bytes: 10_485_760 }] },
    failures: [{ id: 77, task_name: 'apps.core.tasks.cleanup', date_created: new Date().toISOString(), error_message: 'boom' }],
};

describe('System', () => {
    beforeEach(() => {
        installResizeObserver();
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = SUPERUSER;
        api.get.mockResolvedValue(PAYLOAD);
    });

    it('shows health, workers, queues and failures', async () => {
        renderPage(<System />, { path: '/admin/system' });
        expect(await screen.findByText('Everything is running')).toBeInTheDocument();
        expect(screen.getByText('celery@worker-1')).toBeInTheDocument();
        expect(screen.getByText('2 running')).toBeInTheDocument();
        expect(screen.getByText('240')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'cleanup' })).toHaveAttribute('href', '/admin/tasks?open=77');
    });

    it('runs a scheduled job after confirming', async () => {
        api.post.mockResolvedValue({ message: 'refresh-trending queued.' });
        renderPage(<System />, { path: '/admin/system' });
        fireEvent.click(await screen.findByRole('button', { name: 'Run refresh-trending now' }));
        const dialog = screen.getByRole('dialog', { name: 'Run refresh-trending now?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('system/beat/refresh-trending/run'));
    });

    it('hides run controls and task links from staff', async () => {
        auth.user = STAFF;
        api.get.mockResolvedValue({ ...PAYLOAD, can_run: false });
        renderPage(<System />, { path: '/admin/system' });
        await screen.findByText('refresh-trending');
        expect(screen.queryByRole('button', { name: /Run refresh-trending/ })).toBeNull();
        expect(screen.queryByRole('link', { name: 'cleanup' })).toBeNull();
    });

    it('says plainly when no worker answers', async () => {
        api.get.mockResolvedValue({ ...PAYLOAD, workers: { available: true, total: 0, items: [] } });
        renderPage(<System />, { path: '/admin/system' });
        expect(await screen.findByText(/No workers answered/)).toBeInTheDocument();
    });
});
