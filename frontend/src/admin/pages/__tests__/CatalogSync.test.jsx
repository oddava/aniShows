import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import CatalogSync from '../CatalogSync';
import { STAFF, SUPERUSER, renderPage } from './opsTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: null },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const hourAgo = new Date(Date.now() - 3600_000).toISOString();

const lane = (key, label, lastRun = null, extra = {}) => ({
    lane: key,
    label,
    schedule: 'Hourly',
    description: `${label} description.`,
    running: false,
    last_run: lastRun,
    last_success_at: lastRun?.started_at ?? null,
    last_change_at: null,
    ...extra,
});

const RUN = {
    id: 9,
    lane: 'seasons',
    lane_label: 'Seasons',
    trigger: 'schedule',
    status: 'succeeded',
    started_at: hourAgo,
    finished_at: hourAgo,
    duration_seconds: 42,
    requests: 8,
    fetched: 320,
    created: 84,
    updated: 236,
    excluded: 2,
    detail: { seasons: [] },
    error: '',
};

const OVERVIEW = {
    can_run: true,
    totals: { total: 18412, listed: 18100, hidden: 312, hydrated: 2900, waiting_for_details: 4 },
    hidden_reasons: [{ reason: 'country:CN', count: 250 }, { reason: 'format:MUSIC', count: 62 }],
    rules: { countries: ['JP'], excluded_formats: ['MUSIC'] },
    seasons: [
        { season: 'FALL', year: 2026, label: 'Fall 2026', role: 'current', listed: 142, anilist: 142 },
        { season: 'WINTER', year: 2027, label: 'Winter 2027', role: 'next', listed: 80, anilist: 87 },
    ],
    sweep: { phase: 'years', year: 2019, percent: 7 },
    changes_since: hourAgo,
    lanes: [lane('seasons', 'Seasons', RUN), lane('seed', 'Full sweep')],
};

function routeGets(overview = OVERVIEW) {
    api.get.mockImplementation((path) => Promise.resolve(
        path === 'catalog' ? overview : { count: 1, results: [RUN] },
    ));
}

describe('CatalogSync', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = SUPERUSER;
        routeGets();
    });

    it('shows coverage, seasons against AniList, why titles are hidden and the run log', async () => {
        renderPage(<CatalogSync />, { path: '/admin/catalog-sync' });
        expect(await screen.findByText('18,100')).toBeInTheDocument();
        expect(screen.getByText('Winter 2027')).toBeInTheDocument();
        expect(screen.getByText('Made in China')).toBeInTheDocument();
        expect(screen.getByText('Music video')).toBeInTheDocument();
        expect(screen.getByText(/Reading 2019/)).toBeInTheDocument();
        expect(await screen.findAllByText('84 new · 236 updated · 2 hidden')).not.toHaveLength(0);
        expect(api.get).toHaveBeenCalledWith('catalog/runs', expect.objectContaining({ changed: '1' }), expect.anything());
    });

    it('runs one part now', async () => {
        api.post.mockResolvedValue({ message: 'Queued.' });
        renderPage(<CatalogSync />, { path: '/admin/catalog-sync' });
        const lanes = await screen.findByRole('region', { name: 'What runs' });
        fireEvent.click(within(lanes).getAllByRole('button', { name: 'Run now' })[0]);
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('catalog/lanes/seasons/run', {}));
    });

    it('offers to start the sweep when it never ran', async () => {
        routeGets({ ...OVERVIEW, sweep: { phase: 'not_started', percent: 0 } });
        api.post.mockResolvedValue({ message: 'Queued.' });
        renderPage(<CatalogSync />, { path: '/admin/catalog-sync' });
        fireEvent.click(await screen.findByRole('button', { name: 'Start the sweep' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('catalog/lanes/seed/run', {}));
    });

    it('lets staff read but not run', async () => {
        auth.user = STAFF;
        routeGets({ ...OVERVIEW, can_run: false });
        renderPage(<CatalogSync />, { path: '/admin/catalog-sync' });
        await screen.findByText('Winter 2027');
        expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    });
});
