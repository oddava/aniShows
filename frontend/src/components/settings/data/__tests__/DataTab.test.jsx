import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import DataTab from '../DataTab';
import {
    changeDescription,
    jobFailureMessage,
    jobOutcome,
    parseListInput,
    usernameError,
    validateXmlFile,
} from '../importHelpers';

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
    exportData: vi.fn(),
}));

vi.mock('../../../../api/client', () => ({ importExportApi: api }));

const USER = { id: 7, username: 'kiyo', email_verified: true };

const job = (overrides = {}) => ({
    id: 1,
    source: 'mal_api',
    source_display: 'MyAnimeList',
    status: 'completed',
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

function renderTab(user = USER) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <DataTab user={user} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
}

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getImportJobs.mockResolvedValue({ data: [] });
    api.getAniListLink.mockResolvedValue({ data: { linked: false } });
});

describe('import helpers', () => {
    it('reads usernames and profile links from either site', () => {
        expect(parseListInput('  kiyo ')).toEqual({ source: null, username: 'kiyo' });
        expect(parseListInput('@kiyo')).toEqual({ source: null, username: 'kiyo' });
        expect(parseListInput('https://anilist.co/user/Kiyo/animelist')).toEqual({ source: 'anilist', username: 'Kiyo' });
        expect(parseListInput('myanimelist.net/profile/kiyo_2')).toEqual({ source: 'mal', username: 'kiyo_2' });
        expect(parseListInput('https://myanimelist.net/animelist/kiyo?status=7')).toEqual({ source: 'mal', username: 'kiyo' });
    });

    it('checks usernames the way the server does', () => {
        expect(usernameError('', 'AniList')).toMatch(/AniList username/);
        expect(usernameError('has space', 'AniList')).toMatch(/letters, numbers/);
        expect(usernameError('ok_name-1', 'AniList')).toBeNull();
    });

    it('accepts .xml and .xml.gz up to 10 MB', () => {
        expect(validateXmlFile({ name: 'animelist.xml', size: 10 })).toBeNull();
        expect(validateXmlFile({ name: 'animelist_1700000000_-_123.xml.gz', size: 10 })).toBeNull();
        expect(validateXmlFile({ name: 'list.txt', size: 10 })).toMatch(/\.xml/);
        expect(validateXmlFile({ name: 'big.xml.gz', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    });

    it('prefers the fatal reason over the last entry error', () => {
        expect(jobFailureMessage({ failure_reason: 'Took too long', errors: ['Entry A: boom'] })).toBe('Took too long');
        expect(jobFailureMessage({ failure_reason: '', errors: ['first', 'last'] })).toBe('last');
    });

    it('describes a change in a few words', () => {
        expect(changeDescription({ kind: 'added', status: 'Plan to Watch' })).toBe('Planning');
        expect(changeDescription({ kind: 'updated', status: 'Completed', episodes_watched: 12, from: { status: 'Watching', episodes_watched: 10 } }))
            .toBe('Watching → Completed · Ep 10 → 12');
        expect(changeDescription({ kind: 'updated', score: 8, from: { score: 0 } })).toBe('Score – → 8');
        expect(changeDescription({ kind: 'updated', status: 'Watching' })).toBe('Dates or notes');
    });

    it('says what a job did', () => {
        expect(jobOutcome(job())).toBe('80 titles added or updated · 5 skipped · 5 not matched');
        expect(jobOutcome(job({ changes: { added: 70, updated: 10 } }))).toBe('70 added · 10 updated · 5 skipped · 5 not matched');
        expect(jobOutcome(job({ status: 'processing', processed_entries: 30 }))).toBe('30 of 90 entries');
        expect(jobOutcome(job({ mode: 'incremental', imported_entries: 0, skipped_entries: 0, failed_entries: 0 }))).toBe('Already up to date');
        expect(jobOutcome(job({ status: 'cancelled', imported_entries: 1, skipped_entries: 0, failed_entries: 0 }))).toBe('Cancelled. 1 title added or updated');
    });
});

describe('Import', () => {
    it('imports a MyAnimeList username and shows the new job', async () => {
        api.importMAL.mockResolvedValue({ data: { job_id: 2 } });
        renderTab();

        fireEvent.change(screen.getByLabelText('MyAnimeList username'), { target: { value: 'kiyo' } });
        api.getImportJobs.mockResolvedValue({ data: [job({ id: 2, status: 'pending', total_entries: 0, processed_entries: 0 })] });
        api.getImportJobStatus.mockResolvedValue({ data: job({ id: 2, status: 'pending', total_entries: 0, processed_entries: 0 }) });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(api.importMAL).toHaveBeenCalledWith('kiyo'));
        expect(await screen.findByRole('heading', { name: 'Importing now' })).toBeInTheDocument();
        expect(screen.getByText('Waiting to start')).toBeInTheDocument();
        expect(screen.getByLabelText('MyAnimeList username')).toHaveValue('');
    });

    it('switches to AniList when an AniList link is pasted and links it with daily sync on', async () => {
        api.saveAniListLink.mockResolvedValue({ data: { linked: true, username: 'Kiyo', job_id: 3 } });
        renderTab();

        fireEvent.change(screen.getByLabelText('MyAnimeList username'), {
            target: { value: 'https://anilist.co/user/Kiyo/' },
        });
        const input = screen.getByLabelText('AniList username');
        expect(input).toHaveValue('Kiyo');
        expect(screen.getByRole('button', { name: /^AniList/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('switch', { name: 'Keep in sync' })).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(api.saveAniListLink).toHaveBeenCalledWith({ username: 'Kiyo', autoSync: true }));
    });

    it('explains a bad username without calling the server', () => {
        renderTab();
        fireEvent.change(screen.getByLabelText('MyAnimeList username'), { target: { value: 'two words' } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(screen.getByRole('alert')).toHaveTextContent(/letters, numbers/);
        expect(api.importMAL).not.toHaveBeenCalled();
    });

    it('uploads a MyAnimeList export file as soon as it is picked', async () => {
        api.importMALXML.mockResolvedValue({ data: { job_id: 4 } });
        renderTab();

        const file = new File(['<myanimelist/>'], 'animelist.xml.gz', { type: 'application/gzip' });
        fireEvent.change(screen.getByTestId('xml-file-input'), { target: { files: [file] } });

        await waitFor(() => expect(api.importMALXML).toHaveBeenCalledWith(file));
    });

    it('rejects a file that is not a MyAnimeList export', () => {
        renderTab();
        const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
        fireEvent.change(screen.getByTestId('xml-file-input'), { target: { files: [file] } });

        expect(screen.getByRole('alert')).toHaveTextContent(/\.xml/);
        expect(api.importMALXML).not.toHaveBeenCalled();
    });

    it('opens on a linked AniList account with sync controls', async () => {
        api.getAniListLink.mockResolvedValue({
            data: { linked: true, username: 'kiyo', auto_sync: true, last_synced_at: null, sync_available_at: null },
        });
        api.syncAniList.mockResolvedValue({ data: { job_id: 5 } });
        api.unlinkAniList.mockResolvedValue({});
        renderTab();

        expect(await screen.findByText('kiyo')).toBeInTheDocument();
        expect(screen.getByText('Not synced yet')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Keep in sync' })).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(api.syncAniList).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
        await waitFor(() => expect(api.unlinkAniList).toHaveBeenCalled());
    });

    it('shows the linked account picture when AniList gave one', async () => {
        api.getAniListLink.mockResolvedValue({
            data: { linked: true, username: 'kiyo', auto_sync: true, avatar_url: 'https://s4.anilist.co/a.png' },
        });
        const { container } = render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter><DataTab user={USER} /></MemoryRouter>
            </QueryClientProvider>,
        );

        await screen.findByText('kiyo');
        expect(container.querySelector('img[src="https://s4.anilist.co/a.png"]')).toBeInTheDocument();
    });

    it('asks AniList for the picture when the link has none stored yet', async () => {
        api.getAniListLink.mockResolvedValue({ data: { linked: true, username: 'kiyo', auto_sync: true } });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: { User: { avatar: { medium: 'https://s4.anilist.co/b.png' } } } }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const { container } = render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter><DataTab user={USER} /></MemoryRouter>
            </QueryClientProvider>,
        );

        await waitFor(() => expect(container.querySelector('img[src="https://s4.anilist.co/b.png"]')).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledWith('https://graphql.anilist.co', expect.objectContaining({ method: 'POST' }));
        vi.unstubAllGlobals();
    });

    it('turns daily sync off on a linked account', async () => {
        api.getAniListLink.mockResolvedValue({ data: { linked: true, username: 'kiyo', auto_sync: true } });
        api.saveAniListLink.mockResolvedValue({ data: { linked: true, username: 'kiyo', auto_sync: false } });
        renderTab();

        fireEvent.click(await screen.findByRole('switch', { name: 'Keep in sync' }));
        await waitFor(() => expect(api.saveAniListLink).toHaveBeenCalledWith({ username: 'kiyo', autoSync: false }));
    });

    it('asks an unverified user to verify first', () => {
        renderTab({ ...USER, email_verified: false });

        expect(screen.getByText('Verify your email address to import a list.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    });
});

describe('Latest import', () => {
    const withDetail = (jobs, items = []) => {
        api.getImportJobs.mockResolvedValue({ data: jobs });
        api.getImportJobStatus.mockImplementation((id) => {
            const found = jobs.find((item) => item.id === id);
            return Promise.resolve({ data: { ...found, changes: { ...found.changes, items: id === jobs[0].id ? items : [] } } });
        });
    };
    const anime = (id, title) => ({ id, title, slug: `s-${id}`, cover_image: '' });

    it('shows a running import with its progress and cancels it', async () => {
        const running = job({ status: 'processing', processed_entries: 30, progress_percentage: 33 });
        withDetail([running]);
        api.cancelImportJob.mockResolvedValue({});
        renderTab();

        expect(await screen.findByRole('heading', { name: 'Importing now' })).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
        expect(screen.getByText('30 of 90 entries')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(api.cancelImportJob).toHaveBeenCalledWith(1));
    });

    it('breaks the result down and shows each changed title with what changed', async () => {
        withDetail(
            [job({ imported_entries: 2, skipped_entries: 4, failed_entries: 0, changes: { added: 1, updated: 1 } })],
            [
                { anime_id: 10, kind: 'added', status: 'Watching', episodes_watched: 1, anime: anime(10, 'Frieren') },
                { anime_id: 11, kind: 'updated', status: 'Watching', episodes_watched: 6, from: { episodes_watched: 2 }, anime: anime(11, 'Dandadan') },
            ],
        );
        renderTab();

        expect(await screen.findByRole('heading', { name: 'Latest import' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Added 1, Updated 1, Skipped 4' })).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: /Frieren.*Added:.*Watching/ })).toHaveAttribute('href', '/anime/s-10');
        expect(screen.getByRole('link', { name: /Dandadan.*Updated:.*Ep 2 → 6/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Updated\s*1$/ }));
        expect(screen.queryByText('Frieren')).not.toBeInTheDocument();
        expect(screen.getByText('Dandadan')).toBeInTheDocument();
    });

    it('shows why an import failed, what it could not match, and runs it again', async () => {
        withDetail([job({
            status: 'failed',
            failure_reason: 'Took too long; 40 of 90 processed. Run it again to continue.',
            unmatched: [{ title: 'Rare OVA', mal_id: 5, reason: 'not_in_catalog_yet' }],
            changes: { added: 0, updated: 0 },
        })]);
        api.importMAL.mockResolvedValue({ data: { job_id: 2 } });
        renderTab();

        expect(await screen.findByText(/Took too long/)).toBeInTheDocument();
        expect(await screen.findByText('Rare OVA')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(api.importMAL).toHaveBeenCalledWith('kiyo'));
    });

    it('lists earlier imports, five at first, and opens one', async () => {
        withDetail([1, 2, 3, 4, 5, 6, 7].map((id) => job({ id, source: 'mal_xml' })));
        renderTab();

        await screen.findByTestId('import-job-2');
        expect(screen.queryByTestId('import-job-7')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show all 6' }));
        const row = screen.getByTestId('import-job-7');

        fireEvent.click(within(row).getByRole('button', { name: /MyAnimeList file/ }));
        await waitFor(() => expect(api.getImportJobStatus).toHaveBeenCalledWith(7));
    });

    it('says when imports could not be loaded instead of showing nothing', async () => {
        api.getImportJobs.mockRejectedValue(new Error('down'));
        renderTab();

        expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    });
});

describe('Export', () => {
    beforeEach(() => {
        window.URL.createObjectURL = vi.fn(() => 'blob:x');
        window.URL.revokeObjectURL = vi.fn();
    });

    it.each([
        ['Download everything as JSON', 'json'],
        ['Download anime list as MyAnimeList XML', 'xml'],
        ['Download anime list as CSV', 'csv'],
    ])('%s', async (name, format) => {
        api.exportData.mockResolvedValue({ data: new Blob(['x']), headers: {} });
        renderTab();

        fireEvent.click(screen.getByRole('button', { name }));
        await waitFor(() => expect(api.exportData).toHaveBeenCalledWith(format));
        expect(window.URL.createObjectURL).toHaveBeenCalled();
    });

    it('says how many titles the XML file left out', async () => {
        api.exportData.mockResolvedValue({ data: new Blob(['x']), headers: { 'x-export-skipped': '2' } });
        renderTab();

        fireEvent.click(screen.getByRole('button', { name: 'Download anime list as MyAnimeList XML' }));
        expect(await screen.findByText(/2 titles have no MyAnimeList ID/)).toBeInTheDocument();
    });

    it('reports a failed download', async () => {
        api.exportData.mockRejectedValue(new Error('down'));
        renderTab();

        fireEvent.click(screen.getByRole('button', { name: 'Download everything as JSON' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be made/);
    });
});
