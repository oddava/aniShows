import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ImportPage, { jobFailureMessage, validateXmlFile } from '../ImportPage';

const api = vi.hoisted(() => ({
    importMAL: vi.fn(),
    importMALXML: vi.fn(),
    importAniList: vi.fn(),
    getImportJobs: vi.fn(),
    getImportJobStatus: vi.fn(),
    cancelImportJob: vi.fn(),
    getAniListLink: vi.fn(),
    saveAniListLink: vi.fn(),
    unlinkAniList: vi.fn(),
    syncAniList: vi.fn(),
}));

vi.mock('../../api/client', () => ({ importExportApi: api, listApi: {}, activityApi: {}, reviewApi: {}, authApi: {} }));
vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 7, username: 'kiyo' } }),
}));

const job = (overrides = {}) => ({
    id: 1,
    source: 'anilist',
    source_display: 'AniList',
    status: 'completed',
    status_display: 'Completed',
    mode: 'full',
    total_entries: 90,
    processed_entries: 90,
    imported_entries: 80,
    skipped_entries: 5,
    failed_entries: 5,
    fetched_entries: 0,
    progress_percentage: 100,
    errors: [],
    failure_reason: '',
    unmatched: [],
    source_identifier: 'kiyo',
    created_at: '2026-11-16T10:00:00Z',
    ...overrides,
});

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <ImportPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { client, invalidate };
}

const invalidatedKeys = (spy) => spy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getImportJobs.mockResolvedValue({ data: [] });
    api.getAniListLink.mockResolvedValue({ data: { linked: false } });
});

describe('ImportPage helpers', () => {
    it('accepts .xml and .xml.gz up to 10 MB', () => {
        expect(validateXmlFile({ name: 'animelist.xml', size: 10 })).toBeNull();
        expect(validateXmlFile({ name: 'animelist_1700000000_-_123.xml.gz', size: 10 })).toBeNull();
        expect(validateXmlFile({ name: 'list.txt', size: 10 })).toMatch(/\.xml/);
        expect(validateXmlFile({ name: 'big.xml.gz', size: 11 * 1024 * 1024 })).toMatch(/10MB/);
    });

    it('prefers the fatal reason over the oldest entry error', () => {
        expect(jobFailureMessage({ failure_reason: 'Took too long', errors: ['Entry A: boom'] })).toBe('Took too long');
        expect(jobFailureMessage({ failure_reason: '', errors: ['first', 'last'] })).toBe('last');
        expect(jobFailureMessage({})).toBe('Unknown error');
    });
});

describe('ImportPage jobs', () => {
    it('shows a cancelled job with Run again and no Cancel', async () => {
        api.getImportJobs.mockResolvedValue({ data: [job({ status: 'cancelled', status_display: 'Cancelled' })] });
        renderPage();

        const card = await screen.findByTestId('import-job-1');
        expect(within(card).getByText('Cancelled')).toBeInTheDocument();
        expect(within(card).queryByRole('button', { name: /Cancel$/ })).not.toBeInTheDocument();

        api.importAniList.mockResolvedValue({ data: { job_id: 2 } });
        api.getImportJobStatus.mockResolvedValue({ data: job({ id: 2, status: 'pending', status_display: 'Pending' }) });
        fireEvent.click(within(card).getByRole('button', { name: 'Run again' }));
        await waitFor(() => expect(api.importAniList).toHaveBeenCalledWith('kiyo'));
    });

    it('shows the failure reason and the unmatched titles', async () => {
        api.getImportJobs.mockResolvedValue({
            data: [job({
                status: 'failed',
                status_display: 'Failed',
                failure_reason: 'Took too long; 40 of 90 processed. Run it again to continue.',
                errors: ['Some Show: boom'],
                unmatched: [{ title: 'Rare OVA', mal_id: 5, anilist_id: null, reason: 'not_in_catalog_yet' }],
            })],
        });
        renderPage();

        const card = await screen.findByTestId('import-job-1');
        expect(within(card).getByText('Took too long; 40 of 90 processed. Run it again to continue.')).toBeInTheDocument();
        fireEvent.click(within(card).getByText('AniList'));
        expect(within(card).getByText('1 title not matched')).toBeInTheDocument();
        expect(within(card).getByText('Rare OVA')).toBeInTheDocument();
    });

    it('shows progress and cancels an active job', async () => {
        api.getImportJobs.mockResolvedValue({
            data: [job({ status: 'processing', status_display: 'Processing', processed_entries: 30, progress_percentage: 33 })],
        });
        api.cancelImportJob.mockResolvedValue({ data: {} });
        renderPage();

        const card = await screen.findByTestId('import-job-1');
        expect(within(card).getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute('aria-valuenow', '33');
        fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(api.cancelImportJob).toHaveBeenCalledWith(1));
    });

    it('accepts a .xml.gz file and uploads it', async () => {
        api.importMALXML.mockResolvedValue({ data: { job_id: 3 } });
        api.getImportJobStatus.mockResolvedValue({ data: job({ id: 3, source: 'mal_xml', status: 'pending' }) });
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: /MyAnimeList \(XML\)/ }));
        const input = screen.getByTestId('xml-file-input');
        expect(input).toHaveAttribute('accept', '.xml,.gz,application/xml,application/gzip');

        const file = new File(['<myanimelist/>'], 'animelist.xml.gz', { type: 'application/gzip' });
        fireEvent.change(input, { target: { files: [file] } });
        expect(screen.getByText('animelist.xml.gz')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Import from XML/ }));
        await waitFor(() => expect(api.importMALXML).toHaveBeenCalledWith(file));
    });

    it('invalidates the lists and the own profile when a polled job completes', async () => {
        api.importAniList.mockResolvedValue({ data: { job_id: 9 } });
        api.getImportJobStatus.mockResolvedValue({ data: job({ id: 9, status: 'completed' }) });
        const { invalidate } = renderPage();

        fireEvent.click(screen.getByRole('button', { name: /^AniList$/ }));
        fireEvent.change(screen.getByPlaceholderText('AniList username'), { target: { value: 'kiyo' } });
        fireEvent.submit(screen.getByPlaceholderText('AniList username').closest('form'));

        expect(await screen.findByText(/Import completed!/)).toBeInTheDocument();
        const keys = invalidatedKeys(invalidate);
        expect(keys).toContain(JSON.stringify(['lists']));
        expect(keys).toContain(JSON.stringify(['ownProfile']));
        expect(keys).toContain(JSON.stringify(['user', 'list', 'watching']));
    });
});

describe('ImportPage AniList link card', () => {
    it('links a username with daily sync on', async () => {
        api.saveAniListLink.mockResolvedValue({ data: { linked: true, username: 'kiyo', job_id: 4, import_error: null } });
        api.getImportJobStatus.mockResolvedValue({ data: job({ id: 4, status: 'pending' }) });
        renderPage();

        const card = await screen.findByTestId('anilist-link-card');
        fireEvent.change(within(card).getByRole('textbox', { name: 'AniList username to link' }), { target: { value: 'kiyo' } });
        const toggle = within(card).getByRole('switch', { name: 'Sync daily' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(within(card).getByRole('button', { name: 'Link' }));

        await waitFor(() => expect(api.saveAniListLink).toHaveBeenCalledWith({ username: 'kiyo', autoSync: true }));
        expect(await screen.findByText('AniList linked. Importing your list now.')).toBeInTheDocument();
    });

    it('disables Sync now with the reason during the cooldown and shows a paused sync', async () => {
        api.getAniListLink.mockResolvedValue({
            data: {
                linked: true,
                username: 'kiyo',
                auto_sync: true,
                auto_sync_paused: true,
                last_synced_at: '2026-11-16T09:00:00Z',
                last_error: 'This AniList list is private.',
                consecutive_failures: 5,
                sync_available_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                last_job: null,
            },
        });
        renderPage();

        const card = await screen.findByTestId('anilist-link-card');
        expect(within(card).getByRole('button', { name: /Sync now/ })).toBeDisabled();
        expect(within(card).getByText(/Available again at/)).toBeInTheDocument();
        expect(within(card).getByText('This AniList list is private.')).toBeInTheDocument();
        expect(within(card).getByText(/paused after 5 failed syncs/)).toBeInTheDocument();
        expect(within(card).getByRole('switch', { name: 'Sync daily' })).toHaveAttribute('aria-checked', 'false');
    });

    it('starts a sync and unlinks', async () => {
        api.getAniListLink.mockResolvedValue({
            data: { linked: true, username: 'kiyo', auto_sync: false, auto_sync_paused: false, sync_available_at: null, last_synced_at: null },
        });
        api.syncAniList.mockResolvedValue({ data: { job_id: 6, status: 'pending' } });
        api.getImportJobStatus.mockResolvedValue({ data: job({ id: 6, status: 'pending', mode: 'incremental' }) });
        api.unlinkAniList.mockResolvedValue({});
        renderPage();

        const card = await screen.findByTestId('anilist-link-card');
        expect(within(card).getByText('Never')).toBeInTheDocument();
        fireEvent.click(within(card).getByRole('button', { name: /Sync now/ }));
        await waitFor(() => expect(api.syncAniList).toHaveBeenCalled());
        await waitFor(() => expect(api.getImportJobStatus).toHaveBeenCalledWith(6));

        fireEvent.click(within(card).getByRole('button', { name: 'Unlink' }));
        await waitFor(() => expect(api.unlinkAniList).toHaveBeenCalled());
    });
});
