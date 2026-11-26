import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Users, { usersApiParams } from '../Users';
import { renderPage, STAFF, SUPERUSER } from './peopleTestUtils';

const auth = vi.hoisted(() => ({ user: null }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), download: vi.fn() }));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));

const MEMBER = {
    id: 5,
    username: 'mika',
    email: 'mika@example.com',
    is_active: true,
    is_staff: false,
    is_superuser: false,
    email_verified: true,
    date_joined: '2026-10-01T10:00:00Z',
    last_login: null,
    list_entries_count: 12,
    reviews_count: 3,
};
const OTHER_STAFF = { ...MEMBER, id: 6, username: 'helper', email: 'helper@example.com', is_staff: true };

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.get.mockResolvedValue({ count: 2, results: [MEMBER, OTHER_STAFF] });
    api.post.mockResolvedValue({ message: 'User suspended.' });
});

const openMenu = async (user, username) => {
    await user.click(await screen.findByRole('button', { name: `Actions for ${username}` }));
    return screen.getByRole('menu');
};

describe('Users', () => {
    it('lists users from the API', async () => {
        auth.user = SUPERUSER;
        renderPage(<Users />, { path: '/admin/users' });

        expect(await screen.findByText('mika')).toBeInTheDocument();
        expect(screen.getByText('mika@example.com')).toBeInTheDocument();
        expect(screen.getAllByText('12 listed · 3 reviews')).toHaveLength(2);
        expect(api.get).toHaveBeenCalledWith('users', expect.objectContaining({ ordering: '-date_joined', page: 1 }), expect.anything());
    });

    it('maps the role filter onto the API booleans', () => {
        expect(usersApiParams({ role: 'moderators', page: 1 })).toEqual({ page: 1, is_staff: 'true', is_superuser: 'false' });
        expect(usersApiParams({ role: 'staff', page: 1 })).toEqual({ page: 1, is_staff: 'true' });
        expect(usersApiParams({ role: 'superusers' })).toEqual({ is_superuser: 'true' });
        expect(usersApiParams({ search: 'a' })).toEqual({ search: 'a' });
    });

    it('hides superuser-only actions from staff', async () => {
        auth.user = STAFF;
        const user = userEvent.setup();
        renderPage(<Users />, { path: '/admin/users' });

        expect(await screen.findByText('mika')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Select all on this page' })).not.toBeInTheDocument();

        const menu = await openMenu(user, 'mika');
        expect(within(menu).getByRole('menuitem', { name: 'Suspend' })).toBeInTheDocument();
        expect(within(menu).queryByRole('menuitem', { name: 'Delete account' })).not.toBeInTheDocument();
        expect(within(menu).queryByRole('menuitem', { name: 'Make staff' })).not.toBeInTheDocument();
        await user.keyboard('{Escape}');

        // Staff cannot moderate other staff.
        const staffMenu = await openMenu(user, 'helper');
        expect(within(staffMenu).queryByRole('menuitem', { name: 'Suspend' })).not.toBeInTheDocument();
    });

    it('shows superusers the full set', async () => {
        auth.user = SUPERUSER;
        const user = userEvent.setup();
        renderPage(<Users />, { path: '/admin/users' });

        expect(await screen.findByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
        const menu = await openMenu(user, 'mika');
        expect(within(menu).getByRole('menuitem', { name: 'Delete account' })).toBeInTheDocument();
        expect(within(menu).getByRole('menuitem', { name: 'Make staff' })).toBeInTheDocument();
    });

    it('suspends with the reason the admin typed', async () => {
        auth.user = STAFF;
        const user = userEvent.setup();
        renderPage(<Users />, { path: '/admin/users' });

        const menu = await openMenu(user, 'mika');
        await user.click(within(menu).getByRole('menuitem', { name: 'Suspend' }));

        const dialog = await screen.findByRole('dialog', { name: 'Suspend mika?' });
        const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
        expect(confirm).toBeDisabled();
        await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Spam links');
        expect(confirm).toBeEnabled();
        await user.click(confirm);

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('users/5/suspend', { reason: 'Spam links' }));
    });
});
