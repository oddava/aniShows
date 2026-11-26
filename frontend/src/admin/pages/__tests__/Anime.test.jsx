import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Anime from '../Anime';
import { page, renderAdminPage } from './catalogTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: { id: 1, username: 'root', is_staff: true, is_superuser: true } },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/ui/toast', () => ({ notify: vi.fn(), notifyError: vi.fn(), default: vi.fn() }));

const frieren = {
    id: 7,
    title: 'Frieren',
    slug: 'frieren',
    anime_type: 'TV',
    status: 'Finished',
    episode_count: 28,
    rating: '9.10',
    release_date: '2023-09-29',
    favorites_count: 12,
    reviews_count: 3,
    updated_at: '2026-11-20T10:00:00Z',
    poster: null,
};

describe('Anime list', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = { id: 1, username: 'root', is_staff: true, is_superuser: true };
        api.get.mockResolvedValue(page([frieren]));
    });

    it('renders rows from the admin API with the default ordering', async () => {
        renderAdminPage(<Anime />, { path: '/admin/anime' });
        expect(await screen.findByText('Frieren')).toBeInTheDocument();
        expect(screen.getByText('TV · 2023')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('anime', expect.objectContaining({ ordering: '-created_at', page: 1 }), expect.anything());
    });

    it('sends filters from the URL', async () => {
        renderAdminPage(<Anime />, { path: '/admin/anime?status=Airing&missing=cover' });
        await screen.findByText('Frieren');
        expect(api.get).toHaveBeenCalledWith('anime', expect.objectContaining({ status: 'Airing', missing: 'cover' }), expect.anything());
    });

    it('gives staff no selection or bulk delete', async () => {
        auth.user = { id: 2, username: 'mod', is_staff: true, is_superuser: false };
        renderAdminPage(<Anime />, { path: '/admin/anime' });
        await screen.findByText('Frieren');
        expect(screen.queryByLabelText('Select row')).toBeNull();
    });

    it('bulk delete runs a dry run first, then confirms with the matched count', async () => {
        api.post
            .mockResolvedValueOnce({ dry_run: true, matched: 1, would_delete_by_model: { 'anime.Anime': 1, 'users.UserAnimeList': 5 } })
            .mockResolvedValueOnce({ matched: 1, message: 'Deleted 1 anime.' });
        renderAdminPage(<Anime />, { path: '/admin/anime' });
        await screen.findByText('Frieren');

        fireEvent.click(screen.getByLabelText('Select row'));
        const bar = screen.getByRole('region', { name: 'Bulk actions' });
        fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('bulk', {
            operation: 'delete', entity_type: 'anime', entity_ids: [7], dry_run: true,
        }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete 1 anime?' });
        expect(within(dialog).getByText('List entries')).toBeInTheDocument();
        expect(within(dialog).getByText('5')).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('bulk', {
            operation: 'delete', entity_type: 'anime', entity_ids: [7], confirm: 1,
        }));
    });
});
