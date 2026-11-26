import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Forums from '../Forums';
import { renderAdminPage, routeGets } from './communityTestUtils';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), patch: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const thread = {
    id: 3,
    title: 'Best opening of the season',
    category: { id: 1, name: 'General', slug: 'general' },
    author: { id: 4, username: 'yuki' },
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-02T10:00:00Z',
    is_pinned: false,
    is_locked: false,
    is_removed: false,
    reply_count: 12,
    view_count: 340,
    like_count: 5,
    snippet: 'Which one?',
};

describe('Forums', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = { id: 1, username: 'mod', is_staff: true, is_superuser: false };
        routeGets(api.get, {
            'forum-threads': { results: [thread], count: 1 },
            'forum-threads/3': { ...thread, content: 'Which one was your favourite?' },
            'forum-categories': { results: [{ id: 1, name: 'General', slug: 'general', order: 0, thread_count: 1 }], count: 1 },
            'forum-posts': { results: [], count: 0 },
            'forum-tags': { results: [], count: 0 },
        });
    });

    const openMenu = async () => {
        fireEvent.click(await screen.findByRole('button', { name: `Actions for ${thread.title}` }));
        return screen.findByRole('menu');
    };

    it('removes a thread with the reason given', async () => {
        api.post.mockResolvedValue({ ...thread, is_removed: true });
        renderAdminPage(<Forums />, { path: '/admin/forums' });

        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove thread' }));
        const dialog = await screen.findByRole('dialog', { name: 'Remove this thread?' });
        fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Off-topic spam' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove thread' }));

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('forum-threads/3/remove', { reason: 'Off-topic spam' }));
    });

    it('pins a thread with the explicit flag', async () => {
        api.post.mockResolvedValue({ ...thread, is_pinned: true });
        renderAdminPage(<Forums />, { path: '/admin/forums' });

        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pin to the top' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('forum-threads/3/pin', { is_pinned: true }));
    });

    it('hides permanent delete from staff and shows it to superusers', async () => {
        const { unmount } = renderAdminPage(<Forums />, { path: '/admin/forums' });
        let menu = await openMenu();
        expect(within(menu).queryByRole('menuitem', { name: 'Delete permanently' })).not.toBeInTheDocument();
        unmount();

        auth.user = { id: 1, username: 'root', is_staff: true, is_superuser: true };
        renderAdminPage(<Forums />, { path: '/admin/forums' });
        menu = await openMenu();
        expect(within(menu).getByRole('menuitem', { name: 'Delete permanently' })).toBeInTheDocument();
    });

    it('opens a thread from ?tab=threads&open=', async () => {
        renderAdminPage(<Forums />, { path: '/admin/forums?tab=threads&open=3' });

        const drawer = await screen.findByRole('dialog', { name: thread.title });
        expect(await within(drawer).findByText('Which one was your favourite?')).toBeInTheDocument();
    });

    it('lets only superusers add categories', async () => {
        renderAdminPage(<Forums />, { path: '/admin/forums?tab=categories' });
        expect(await screen.findByText('General')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    });
});
