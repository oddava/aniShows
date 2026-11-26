import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

import { renderPage, STAFF, SUPERUSER } from './peopleTestUtils';

const auth = vi.hoisted(() => ({ value: { user: null } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth.value }));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, adminApi: { ...actual.adminApi, get: api.get } };
});

import Dashboard, { fillDays } from '../Dashboard';

const PAYLOAD = {
    statistics: {
        users: { total: 1200, new_7d: 31, new_30d: 90, verified: 900, active_7d: 410 },
        content: { total_anime: 5400, airing_anime: 62, total_reviews: 830, new_reviews_7d: 12 },
        engagement: { total_favorites: 3000, total_list_entries: 25000 },
    },
    charts: { user_growth: [{ date: '2026-11-20', count: 3 }], reviews_30d: [] },
    attention: { open_reports: 5, open_reviews: 3, failed_tasks_24h: 2, quarantined_sync: 0, failed_user_imports_24h: 0, suspended_users: 1 },
    popular_anime: [{ id: 7, title: 'Frieren', slug: 'frieren', favorite_count: 88, poster: null }],
    recent_reviews: [{ id: 4, user: 'mika', anime: 'Frieren', anime_slug: 'frieren', rating: 9, has_spoilers: false, created_at: '2026-11-25T10:00:00Z' }],
    recent_users: [{ id: 9, username: 'sora', email: 's@example.com', date_joined: '2026-11-25T09:00:00Z', is_active: true, is_staff: false }],
};

beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue(PAYLOAD);
});

describe('Dashboard', () => {
    it('lists what needs attention, each linking to where it is handled', async () => {
        auth.value = { user: SUPERUSER };
        renderPage(<Dashboard />, { path: '/admin' });
        const reported = await screen.findByRole('link', { name: /reviews are reported/ });
        expect(reported).toHaveAttribute('href', '/admin/moderation');
        expect(screen.getByRole('link', { name: /tasks failed today/ })).toHaveAttribute('href', '/admin/tasks?status=FAILURE');
        expect(screen.getByRole('link', { name: /account is suspended/ })).toHaveAttribute('href', '/admin/users?is_active=false');
        expect(screen.queryByText(/held back from syncing/)).not.toBeInTheDocument();
    });

    it('sends staff to the System page for failed tasks', async () => {
        auth.value = { user: STAFF };
        renderPage(<Dashboard />, { path: '/admin' });
        expect(await screen.findByRole('link', { name: /tasks failed today/ })).toHaveAttribute('href', '/admin/system');
    });

    it('shows the key numbers and recent activity', async () => {
        auth.value = { user: SUPERUSER };
        renderPage(<Dashboard />, { path: '/admin' });
        expect(await screen.findByText('1,200')).toBeInTheDocument();
        expect(screen.getByText('31 joined this week')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'sora' })).toHaveAttribute('href', '/admin/users/9');
        const animeLinks = screen.getAllByRole('link', { name: 'Frieren' }).map((link) => link.getAttribute('href'));
        expect(animeLinks).toEqual(expect.arrayContaining(['/admin/reviews?open=4', '/admin/anime/7']));
    });

    it('says all clear when nothing is open', async () => {
        auth.value = { user: SUPERUSER };
        api.get.mockResolvedValue({ ...PAYLOAD, attention: { open_reports: 0, open_reviews: 0 } });
        renderPage(<Dashboard />, { path: '/admin' });
        expect(await screen.findByText(/All clear/)).toBeInTheDocument();
    });
});

describe('fillDays', () => {
    it('returns one row per day with zeros for missing days', () => {
        const rows = fillDays([], 7);
        expect(rows).toHaveLength(7);
        expect(rows.every((row) => row.count === 0)).toBe(true);
    });
});
