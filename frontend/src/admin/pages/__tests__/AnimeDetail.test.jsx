import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import AnimeDetail from '../AnimeDetail';
import { apiError, renderAdminPage } from './catalogTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: { id: 1, username: 'root', is_staff: true, is_superuser: true } },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/ui/toast', () => ({ notify: vi.fn(), notifyError: vi.fn(), default: vi.fn() }));

const anime = {
    id: 7,
    title: 'Frieren',
    title_jp: '葬送のフリーレン',
    slug: 'frieren',
    anime_type: 'TV',
    status: 'Finished',
    season: 'FALL',
    season_year: 2023,
    episode_count: 28,
    synopsis: 'An elf mage outlives her party.',
    anilist_id: 154587,
    mal_id: 52991,
    meta_description: '',
    genres: [{ id: 1, name: 'Fantasy' }],
    studios: [{ id: 3, name: 'Madhouse' }],
    favorites_count: 12,
    reviews_count: 3,
    sync_state: { metadata_status: 'synced', franchise_status: 'synced', quarantined: false },
    cover_image_external_url: 'https://img.example/c.jpg',
};

const renderDetail = () => renderAdminPage(<AnimeDetail />, { path: '/admin/anime/7', route: '/admin/anime/:animeId' });

describe('Anime detail', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = { id: 1, username: 'root', is_staff: true, is_superuser: true };
        api.get.mockResolvedValue(anime);
    });

    it('shows the anime with its provider links', async () => {
        renderDetail();
        expect(await screen.findByRole('heading', { level: 1, name: 'Frieren' })).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('anime/7', undefined, expect.anything());
        expect(screen.getByText('Fall 2023')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /154587/ })).toHaveAttribute('href', 'https://anilist.co/anime/154587');
        expect(screen.getByRole('link', { name: /View on site/ })).toHaveAttribute('href', '/anime/frieren');
    });

    it('refresh from AniList posts to the anime refresh endpoint after confirming', async () => {
        api.post.mockResolvedValue({ message: "Refresh of 'Frieren' queued." });
        renderDetail();
        fireEvent.click(await screen.findByRole('button', { name: 'Refresh from AniList' }));
        const dialog = await screen.findByRole('dialog', { name: 'Refresh from AniList?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('anime/7/refresh'));
    });

    it('refresh is unavailable without an AniList id', async () => {
        api.get.mockResolvedValue({ ...anime, anilist_id: null });
        renderDetail();
        expect(await screen.findByRole('button', { name: 'Refresh from AniList' })).toBeDisabled();
    });

    it('gives staff no write actions', async () => {
        auth.user = { id: 2, username: 'mod', is_staff: true, is_superuser: false };
        renderDetail();
        await screen.findByRole('heading', { level: 1, name: 'Frieren' });
        expect(screen.queryByRole('button', { name: 'Refresh from AniList' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('says so when the anime does not exist', async () => {
        api.get.mockRejectedValue(apiError(404, { detail: 'Not found.' }));
        renderDetail();
        expect(await screen.findByRole('heading', { name: 'Anime not found' })).toBeInTheDocument();
    });
});
