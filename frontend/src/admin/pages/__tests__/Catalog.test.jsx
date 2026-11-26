import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Genres from '../Genres';
import People from '../People';
import { apiError, page, renderAdminPage } from './catalogTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: { id: 1, username: 'root', is_staff: true, is_superuser: true } },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/ui/toast', () => ({ notify: vi.fn(), notifyError: vi.fn(), default: vi.fn() }));

const action = { id: 1, name: 'Action', slug: 'action', description: '', anime_count: 3 };

const openRowMenuItem = async (rowName, item) => {
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${rowName}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
};

describe('Catalog pages', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = { id: 1, username: 'root', is_staff: true, is_superuser: true };
        api.get.mockResolvedValue(page([action]));
    });

    it('lists genres from the admin API', async () => {
        renderAdminPage(<Genres />, { path: '/admin/genres' });
        expect(await screen.findByText('Action')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('genres', expect.objectContaining({ page: 1 }), expect.anything());
        expect(screen.getByRole('button', { name: 'Add genre' })).toBeInTheDocument();
    });

    it('a genre still linked to anime can be deleted anyway, with force', async () => {
        api.del
            .mockRejectedValueOnce(apiError(400, { detail: 'Cannot delete genre with 3 associated anime. Use ?force=true to delete anyway.', anime_count: 3 }))
            .mockResolvedValueOnce({ message: "Genre 'Action' deleted successfully." });
        renderAdminPage(<Genres />, { path: '/admin/genres' });
        await openRowMenuItem('Action', 'Delete');

        const first = await screen.findByRole('dialog', { name: 'Delete Action?' });
        fireEvent.click(within(first).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.del).toHaveBeenCalledWith('genres/1', undefined));

        const second = await screen.findByRole('dialog', { name: 'Still linked to 3 anime' });
        fireEvent.click(within(second).getByRole('button', { name: 'Delete anyway' }));
        await waitFor(() => expect(api.del).toHaveBeenLastCalledWith('genres/1', { force: 'true' }));
    });

    it('creates a genre and shows field errors inline', async () => {
        api.post.mockRejectedValueOnce(apiError(400, { name: ['genre with this name already exists.'] }));
        renderAdminPage(<Genres />, { path: '/admin/genres' });
        fireEvent.click(await screen.findByRole('button', { name: 'Add genre' }));
        const dialog = await screen.findByRole('dialog', { name: 'New genre' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Action' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add genre' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('genres', { name: 'Action', slug: '', description: '' }));
        expect(await within(dialog).findByText('genre with this name already exists.')).toBeInTheDocument();
    });

    it('staff see the catalog read only', async () => {
        auth.user = { id: 2, username: 'mod', is_staff: true, is_superuser: false };
        renderAdminPage(<Genres />, { path: '/admin/genres' });
        await screen.findByText('Action');
        expect(screen.getByText(/Read only/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add genre' })).toBeNull();
        expect(screen.queryByLabelText('Select row')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Action' }));
        expect(await screen.findByRole('menuitem', { name: 'View details' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    });

    it('people map to the staff API and sort by name', async () => {
        api.get.mockResolvedValue(page([{ id: 9, name: 'Kana Hanazawa', name_native: '花澤香菜', anilist_id: 95185, anime_count: 40 }]));
        renderAdminPage(<People />, { path: '/admin/people' });
        expect(await screen.findByText('Kana Hanazawa')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('staff', expect.objectContaining({ ordering: 'name' }), expect.anything());
    });
});
