import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VoiceActorDetail from '../VoiceActorDetail';
import { staffApi } from '../../api/client';

vi.mock('../../api/client', () => ({
    animeApi: {},
    characterApi: { getById: vi.fn() },
    genreApi: {},
    staffApi: { getById: vi.fn() },
    studioApi: {},
    staffFavoriteApi: { toggle: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('../../components/SEO', () => ({
    default: (props) => (
        <div
            data-testid="seo"
            data-title={props.customTitle}
            data-description={props.customDescription}
            data-canonical={props.canonical}
            data-og-image={props.ogImage}
            data-og-type={props.ogType}
            data-noindex={props.noIndex ? 'true' : undefined}
        />
    ),
}));

const anime = (id) => ({ id, slug: `anime-${id}`, title: `Anime ${id}` });

const voiceRole = (id, animeId, character, role = 'MAIN') => ({
    id,
    role,
    anime: anime(animeId),
    character,
});

function renderStaff(staff) {
    staffApi.getById.mockResolvedValue({ data: staff });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[`/staff/${staff.id}`]}>
                <Routes>
                    <Route path="/staff/:id" element={<VoiceActorDetail />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

const baseStaff = {
    id: 5,
    name: 'Atsumi Tanezaki',
    name_native: '種﨑敦美',
    image: '/media/staff/5.jpg',
    description: '',
    voice_roles: [],
    production_credits: [],
};

describe('VoiceActorDetail', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('links only http(s) URLs in the description; other schemes stay plain text', async () => {
        renderStaff({
            ...baseStaff,
            description: 'Site: [Official](https://example.com/atsumi), [bad](javascript:alert(1)), '
                + '[blob](data:text/html,hi) and [local](/admin).',
        });

        const official = await screen.findByRole('link', { name: 'Official' });
        expect(official).toHaveAttribute('href', 'https://example.com/atsumi');
        expect(official).toHaveAttribute('rel', 'noopener noreferrer');
        for (const name of ['bad', 'blob', 'local']) {
            expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
            expect(screen.getByText(name)).toBeInTheDocument();
        }
        expect(document.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull();
    });

    it('shows each anime once with its characters, the first 60, then Show all', async () => {
        const frieren = { id: 1, name: 'Frieren' };
        const roles = [
            voiceRole(1, 1, frieren),
            ...Array.from({ length: 74 }, (_, index) => voiceRole(index + 2, index + 2, { id: 100 + index, name: `Character ${index}` })),
            voiceRole(200, 1, { id: 2, name: 'Fern' }, 'SUPPORTING'),
            voiceRole(201, 1, frieren),
        ];
        renderStaff({ ...baseStaff, voice_roles: roles });

        await screen.findByRole('heading', { name: 'Atsumi Tanezaki' });
        // Title links (the cover links are decorative duplicates).
        expect(screen.getAllByText(/^Anime \d+$/)).toHaveLength(60);
        expect(screen.getByText('75 appearances')).toBeInTheDocument();

        // Anime 1 appears once, with both of its characters.
        const anime1 = screen.getAllByText('Anime 1');
        expect(anime1).toHaveLength(1);
        const card = anime1[0].closest('li');
        expect(within(card).getByRole('link', { name: 'Frieren' })).toHaveAttribute('href', '/character/1');
        expect(within(card).getByRole('link', { name: 'Fern' })).toHaveAttribute('href', '/character/2');
        expect(within(card).getByText('Main · Supporting')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show all 75' }));

        expect(screen.getAllByText(/^Anime \d+$/)).toHaveLength(75);
        expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
    });

    it('has no Show all button for a short list', async () => {
        renderStaff({ ...baseStaff, voice_roles: [voiceRole(1, 1, { id: 1, name: 'Frieren' })] });

        await screen.findByText('Anime 1');
        expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
    });

    it('sets a canonical, og tags and the AniShows brand', async () => {
        renderStaff({ ...baseStaff, description: 'Born in __Tokyo__. ~!Secret!~ [Site](https://example.com)' });

        await screen.findByRole('heading', { name: 'Atsumi Tanezaki' });
        const seo = screen.getByTestId('seo');
        expect(seo).toHaveAttribute('data-title', 'Atsumi Tanezaki | AniShows');
        expect(seo).toHaveAttribute('data-canonical', 'https://anishows.com/staff/5');
        expect(seo).toHaveAttribute('data-og-image', 'https://anishows.com/media/staff/5.jpg');
        expect(seo).toHaveAttribute('data-og-type', 'profile');
        const description = seo.getAttribute('data-description');
        expect(description).toContain('Born in Tokyo.');
        expect(description).toContain('Site');
        expect(description).not.toMatch(/Secret|__|https:/);
    });
});
