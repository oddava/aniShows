import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminSystem from '../AdminSystem';

const { getMock, postMock, toastSuccess, toastError, role } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    role: { isSuperuser: true, isStaff: true },
}));

vi.mock('../../../api/client', () => ({
    default: {
        get: (...args) => getMock(...args),
        post: (...args) => postMock(...args),
    },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => role }));

const snapshot = (overrides = {}) => ({
    generated_at: '2026-11-16T07:00:00Z',
    can_run: true,
    queues: { available: true, items: [{ name: 'default', size: 3 }, { name: 'low_priority', size: 0 }] },
    workers: { available: true, items: [{ name: 'celery@web-1', active_tasks: 2 }], total: 1 },
    beat: [
        {
            name: 'cleanup-task-results-daily',
            task: 'apps.core.tasks.cleanup_tasks.cleanup_old_task_results',
            kwargs: { days: 7 },
            schedule: '0 1 * * *',
            queue: 'low_priority',
            last_run: '2026-11-15T01:00:00Z',
            next_due: '2026-11-16T01:00:00Z',
            stale: true,
            tracked: true,
        },
        {
            name: 'health-check-workers-hourly',
            task: 'apps.core.tasks.cleanup_tasks.health_check_workers',
            kwargs: {},
            schedule: '15 * * * *',
            queue: 'low_priority',
            last_run: null,
            next_due: null,
            stale: false,
            tracked: true,
        },
    ],
    anilist: { available: false },
    database: { available: true, size_bytes: 52428800, tables: [{ name: 'core_systemlog', size_bytes: 10485760 }] },
    health: { database: true, cache: true, migrations_pending: false },
    failures: [{ id: 1, task_name: 'apps.animes.tasks.sync.sync_anime_catalog', date_created: '2026-11-15T03:00:00Z', error_message: 'Timeout' }],
    ...overrides,
});

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AdminSystem />
        </QueryClientProvider>,
    );
};

describe('AdminSystem', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
        toastSuccess.mockReset();
        toastError.mockReset();
        role.isSuperuser = true;
        getMock.mockResolvedValue({ data: snapshot() });
    });

    it('renders every section, a stale badge and the AniList unavailable state', async () => {
        renderPage();

        const queues = await screen.findByRole('region', { name: 'Queues' });
        expect(within(queues).getByText('default')).toBeInTheDocument();
        expect(within(queues).getByText('3')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Workers' })).getByText('2 active')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'AniList' })).getByText('AniList budget unavailable.')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Database' })).getByText('50 MB')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Recent failures' })).getByText('Timeout')).toBeInTheDocument();

        const beat = screen.getByRole('region', { name: 'Scheduled tasks' });
        const items = within(beat).getAllByRole('listitem');
        expect(within(items[0]).getByText('Stale')).toBeInTheDocument();
        expect(within(items[1]).queryByText('Stale')).toBeNull();
        expect(within(items[1]).getByText(/Last run never/)).toBeInTheDocument();
        expect(getMock).toHaveBeenCalledWith('/admin/system/', expect.objectContaining({ signal: expect.anything() }));
    });

    it('refreshes on demand with refresh=1 and never polls', async () => {
        renderPage();
        await screen.findByRole('region', { name: 'Queues' });
        expect(getMock).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
        expect(getMock.mock.calls[1][1]).toEqual(expect.objectContaining({ params: { refresh: 1 } }));
    });

    it('lets superusers run a beat entry after confirming', async () => {
        postMock.mockResolvedValue({ data: { message: 'Started cleanup-task-results-daily.' } });
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Run cleanup-task-results-daily now' }));
        const dialog = screen.getByRole('alertdialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));

        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Started cleanup-task-results-daily.'));
        expect(postMock).toHaveBeenCalledWith('/admin/system/beat/cleanup-task-results-daily/run/');
    });

    it('hides Run now from staff', async () => {
        role.isSuperuser = false;
        renderPage();
        await screen.findByRole('region', { name: 'Scheduled tasks' });

        expect(screen.queryByRole('button', { name: /Run .* now/ })).toBeNull();
    });

    it('shows the AniList budget when the accessor is available', async () => {
        getMock.mockResolvedValue({
            data: snapshot({
                anilist: {
                    available: true, limit: 90, used_this_minute: 12, interactive_used: 4,
                    paused_until: null, breaker: { state: 'closed', failures: 0, last_failure: null },
                },
            }),
        });
        renderPage();

        const anilist = await screen.findByRole('region', { name: 'AniList' });
        expect(within(anilist).getByText('12 / 90')).toBeInTheDocument();
        expect(within(anilist).getByText('closed')).toBeInTheDocument();
    });
});
