import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Imports from '../Imports';
import { buildTriggerBody } from '../ops/TriggerImportDialog';
import { STAFF, SUPERUSER, httpError, renderPage } from './opsTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: null },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const JOB = {
    id: 5,
    task_id: 'abc-123',
    source: 'Anime Offline Database',
    source_type: 'latest',
    status: 'completed',
    processed_items: 40,
    total_items: 50,
    error_count: 0,
    error_message: null,
    created_at: new Date(Date.now() - 600_000).toISOString(),
    updated_at: new Date().toISOString(),
    duration_seconds: 120,
    metadata: { task_kwargs: { release_tag: 'latest' }, result_data: {}, worker: 'w1', retries: 0 },
};

describe('Catalog imports', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = SUPERUSER;
        api.get.mockResolvedValue({ count: 1, results: [JOB] });
    });

    it('lists jobs with their progress', async () => {
        renderPage(<Imports />, { path: '/admin/imports' });
        expect(await screen.findByText('Anime Offline Database')).toBeInTheDocument();
        expect(screen.getByText(/40 of 50/)).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('import-jobs', expect.objectContaining({ ordering: '-date_created', page: 1 }), expect.anything());
    });

    it('starts a trending refresh with the right body', async () => {
        api.post.mockResolvedValue({ message: 'Queued.', job_id: 9, status: 'pending' });
        renderPage(<Imports />, { path: '/admin/imports' });
        fireEvent.click(await screen.findByRole('button', { name: 'New import' }));
        const dialog = screen.getByRole('dialog', { name: 'New import' });
        fireEvent.change(within(dialog).getByLabelText('Source'), { target: { value: 'trending' } });
        fireEvent.change(within(dialog).getByLabelText('How many anime'), { target: { value: '120' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start import' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('import-jobs/trigger', { source: 'trending', limit: 120 }));
    });

    it('explains a 409 as an import already running', async () => {
        api.post.mockRejectedValue(httpError(409, { detail: 'This task is already pending or running.' }));
        renderPage(<Imports />, { path: '/admin/imports' });
        fireEvent.click(await screen.findByRole('button', { name: 'New import' }));
        const dialog = screen.getByRole('dialog', { name: 'New import' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start import' }));
        expect(await within(dialog).findByText('This import is already running')).toBeInTheDocument();
    });

    it('does not offer new imports to staff', async () => {
        auth.user = STAFF;
        renderPage(<Imports />, { path: '/admin/imports' });
        await screen.findByText('Anime Offline Database');
        expect(screen.queryByRole('button', { name: 'New import' })).toBeNull();
    });

    it('builds each source body with only its own fields', () => {
        const base = {
            sync_type: 'full_catalog', limit: '5000', batch_size: '100', status: 'Airing', missing_tags_only: true,
            release_tag: ' latest ', import_limit: '', offline_batch_size: '250', enrichment_chunk_size: '100', resume: true, enqueue_enrichment: false,
        };
        expect(buildTriggerBody({ ...base, source: 'anime_catalog' })).toEqual({ source: 'anime_catalog', sync_type: 'full_catalog', limit: 5000 });
        expect(buildTriggerBody({ ...base, source: 'metadata_enrichment' })).toEqual({
            source: 'metadata_enrichment', batch_size: 100, missing_tags_only: true, status: 'Airing',
        });
        expect(buildTriggerBody({ ...base, source: 'offline_catalog' })).toEqual({
            source: 'offline_catalog', release_tag: 'latest', batch_size: 250, enrichment_chunk_size: 100, resume: true, enqueue_enrichment: false,
        });
    });
});
