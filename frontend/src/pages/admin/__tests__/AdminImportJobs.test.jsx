import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminImportJobs from '../AdminImportJobs';
import { enrichmentRowsOf } from '../components/importJobs/ImportJobDetails';

const { getMock, postMock, toastSuccess, role } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    toastSuccess: vi.fn(),
    role: { userId: 1, isSuperuser: true, isStaff: true },
}));

vi.mock('../../../api/client', () => ({
    default: { get: (...args) => getMock(...args), post: (...args) => postMock(...args) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => role }));

const offlineJob = {
    id: 3,
    task_id: 'abc',
    source: 'Anime Offline Database',
    source_type: 'latest',
    status: 'completed',
    processed_items: 10,
    total_items: 10,
    error_count: 0,
    error_message: '',
    created_at: '2026-11-15T10:00:00Z',
    updated_at: '2026-11-15T10:05:00Z',
    duration_seconds: 300,
    // No `franchises` group: the page must not crash.
    metadata: { offline_import: { enrichment: { overall: { queued: 10, completed: 4, completion_percent: 40 }, metadata: { queued: 10, completed: 4 } } } },
};

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><AdminImportJobs /></QueryClientProvider>);
};

describe('AdminImportJobs', () => {
    beforeEach(() => {
        role.isSuperuser = true;
        getMock.mockReset();
        postMock.mockReset();
        toastSuccess.mockReset();
        getMock.mockResolvedValue({ data: { results: [offlineJob], count: 1 } });
    });

    it('skips missing progress groups instead of crashing', async () => {
        expect(enrichmentRowsOf(undefined)).toEqual([]);
        expect(enrichmentRowsOf({ overall: { queued: 1 } }).map((r) => r.label)).toEqual(['Overall']);

        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
        const dialog = screen.getByRole('dialog', { name: 'Import Job #3' });
        expect(within(dialog).getByText('Enrichment Progress')).toBeInTheDocument();
        const groups = within(dialog).getAllByRole('term').map((term) => term.textContent);
        expect(groups).toEqual(['Overall', 'Metadata']);
    });

    it('triggers metadata enrichment with the slim API payload', async () => {
        postMock.mockResolvedValue({ data: { message: 'ok', job_id: 9, status: 'pending' } });
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: /Trigger job/ }));

        fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
        fireEvent.click(screen.getByRole('option', { name: 'AniList Metadata' }));
        fireEvent.click(screen.getByRole('button', { name: 'Trigger Job' }));

        await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/import-jobs/trigger/', {
            source: 'metadata_enrichment',
            batch_size: 100,
        }));
        expect(toastSuccess).toHaveBeenCalledWith('Import job triggered successfully');
    });

    it('gives staff no trigger form and no cancel', async () => {
        role.isSuperuser = false;
        getMock.mockResolvedValue({ data: { results: [{ ...offlineJob, status: 'processing' }], count: 1 } });
        renderPage();
        await screen.findByRole('button', { name: 'Details' });

        expect(screen.queryByRole('button', { name: /Trigger job/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });
});
