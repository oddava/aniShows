import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserDetail from '../UserDetail';
import { describeHistoryEntry } from '../people/history';
import { renderPage, STAFF, SUPERUSER } from './peopleTestUtils';

const auth = vi.hoisted(() => ({ user: null }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));

const DETAIL = {
    id: 5,
    username: 'mika',
    email: 'mika@example.com',
    is_active: true,
    is_staff: false,
    is_superuser: false,
    email_verified: false,
    date_joined: '2026-10-01T10:00:00Z',
    last_login: '2026-11-20T10:00:00Z',
    profile: { email_verified: false, preferred_timezone: 'Asia/Tashkent', points: 40, is_private: false },
    stats: { list_entries: 12, reviews: 3, favorites: 4, followers: 1, following: 2, forum_threads: 1, forum_posts: 5, badges: 0 },
    list_breakdown: { Watching: 3, 'Plan to Watch': 9 },
    recent_reviews: [{ id: 77, anime: { id: 9, title: 'Frieren', slug: 'frieren' }, rating: 9, snippet: 'Quiet and lovely.', created_at: '2026-11-01T00:00:00Z' }],
    recent_threads: [],
    badges: [],
    auth_providers: ['google'],
    moderation_history: [
        { id: 1, action: 'SUSPEND', actor: 'root', reason: 'Spam', timestamp: '2026-11-02T00:00:00Z', changes: { is_active: { old: true, new: false } } },
    ],
};

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.get.mockResolvedValue(DETAIL);
});

describe('UserDetail', () => {
    it('shows the account, activity and history', async () => {
        auth.user = SUPERUSER;
        renderPage(<UserDetail />, { path: '/admin/users/5', route: '/admin/users/:userId' });

        expect(await screen.findByRole('heading', { level: 1, name: 'mika' })).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('users/5', undefined, expect.anything());
        expect(screen.getByText('mika@example.com')).toBeInTheDocument();
        expect(screen.getByText('Password, Google')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Frieren' })).toHaveAttribute('href', '/admin/reviews?open=77');
        expect(screen.getByText('Suspended')).toBeInTheDocument();
        expect(screen.getByText('Spam')).toBeInTheDocument();
    });

    it('keeps superuser actions out of the staff menu', async () => {
        auth.user = STAFF;
        const user = userEvent.setup();
        renderPage(<UserDetail />, { path: '/admin/users/5', route: '/admin/users/:userId' });

        expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'More account actions' }));
        const menu = screen.getByRole('menu');
        expect(within(menu).getByRole('menuitem', { name: 'Sign out everywhere' })).toBeInTheDocument();
        expect(within(menu).queryByRole('menuitem', { name: 'Mark email verified' })).not.toBeInTheDocument();
        expect(within(menu).queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
    });

    it('offers superusers verify and delete', async () => {
        auth.user = SUPERUSER;
        const user = userEvent.setup();
        renderPage(<UserDetail />, { path: '/admin/users/5', route: '/admin/users/:userId' });

        await user.click(await screen.findByRole('button', { name: 'More account actions' }));
        const menu = screen.getByRole('menu');
        expect(within(menu).getByRole('menuitem', { name: 'Mark email verified' })).toBeInTheDocument();
        expect(within(menu).getByRole('menuitem', { name: 'Delete account' })).toBeInTheDocument();
    });

    it('says plainly when the user does not exist', async () => {
        auth.user = SUPERUSER;
        api.get.mockRejectedValue({ response: { status: 404, data: { detail: 'Not found.' } } });
        renderPage(<UserDetail />, { path: '/admin/users/404', route: '/admin/users/:userId' });

        expect(await screen.findByText('This account does not exist')).toBeInTheDocument();
    });

    it('describes history rows in words', () => {
        expect(describeHistoryEntry({ action: 'UPDATE', changes: { is_staff: { old: false, new: true } } })).toBe('Made staff');
        expect(describeHistoryEntry({ action: 'RESTORE', changes: {} })).toBe('Restored');
        expect(describeHistoryEntry({ action: 'UPDATE', changes: { bio: { old: 'x', new: '' } } })).toBe('Bio changed');
    });
});
