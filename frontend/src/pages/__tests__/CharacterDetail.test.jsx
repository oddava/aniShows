import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CharacterDetail from '../CharacterDetail';
import { characterApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    animeApi: {},
    characterApi: { getById: vi.fn() },
    genreApi: {},
    staffApi: { getById: vi.fn() },
    studioApi: {},
    characterFavoriteApi: { toggle: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('../../components/SEO', () => ({
    default: (props) => (
        <div data-testid="seo" data-title={props.customTitle} data-canonical={props.canonical} />
    ),
}));

function renderCharacter(character) {
    characterApi.getById.mockResolvedValue({ data: character });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[`/character/${character.id}`]}>
                <Routes>
                    <Route path="/character/:id" element={<CharacterDetail />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

describe('CharacterDetail', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('lists an anime once with all its voice actors and only links http(s) URLs', async () => {
        const show = { id: 1, slug: 'frieren', title: 'Frieren' };
        renderCharacter({
            id: 9,
            name: 'Frieren',
            image: 'https://img.anilist.co/frieren.jpg',
            description: 'An elf. See [AniList](https://anilist.co/character/9) or [x](javascript:alert(1)).',
            anime_roles: [
                { id: 1, role: 'MAIN', anime: show, voice_actor: { id: 5, name: 'Atsumi Tanezaki' } },
                { id: 2, role: 'MAIN', anime: show, voice_actor: { id: 6, name: 'Mallorie Rodak' } },
            ],
        });

        await screen.findByRole('heading', { level: 1, name: 'Frieren' });
        // One entry: its cover link and its title link both point at the anime.
        expect(document.querySelectorAll('a[href="/anime/frieren"]')).toHaveLength(2);
        expect(screen.getByText('1 appearance')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Atsumi Tanezaki' })).toHaveAttribute('href', '/staff/5');
        expect(screen.getByRole('link', { name: 'Mallorie Rodak' })).toHaveAttribute('href', '/staff/6');
        expect(screen.getByRole('link', { name: 'AniList' })).toHaveAttribute('href', 'https://anilist.co/character/9');
        expect(screen.queryByRole('link', { name: 'x' })).not.toBeInTheDocument();

        const seo = screen.getByTestId('seo');
        expect(seo).toHaveAttribute('data-title', 'Frieren | AniShows');
        expect(seo).toHaveAttribute('data-canonical', 'https://anishows.com/character/9');
    });
});
