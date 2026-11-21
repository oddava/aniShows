import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InformationBox from './InformationBox';

describe('InformationBox', () => {
    it('renders clickable anime tags that link to browse with the tag filter applied', () => {
        const anime = {
            anime_type: 'TV',
            episode_count: 12,
            status_distribution: {},
            genres: [{ id: 1, name: 'Adventure', slug: 'adventure' }],
            tags: ['male protagonist', 'time travel'],
            external_links: [],
        };

        render(
            <MemoryRouter>
                <InformationBox anime={anime} />
            </MemoryRouter>
        );

        expect(screen.getByText('Tags')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'male protagonist' })).toHaveAttribute(
            'href',
            '/browse?tags=male+protagonist'
        );
        expect(screen.getByRole('link', { name: 'time travel' })).toHaveAttribute(
            'href',
            '/browse?tags=time+travel'
        );
    });

    it('renders next episode countdown whenever next_airing_date is present', () => {
        const anime = {
            anime_type: 'TV',
            episode_count: 12,
            status: 'Unknown',
            next_airing_episode: 8,
            next_airing_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            status_distribution: {},
            genres: [],
            tags: [],
            external_links: [],
        };

        render(
            <MemoryRouter>
                <InformationBox anime={anime} />
            </MemoryRouter>
        );

        expect(screen.getByText('Next episode')).toBeInTheDocument();
        expect(screen.getByText('Episode 8')).toBeInTheDocument();
    });

    const baseAnime = {
        id: 5,
        anime_type: 'TV',
        episode_count: 12,
        status_distribution: {},
        genres: [],
        tags: [],
        external_links: [],
    };

    const renderBox = (anime, props = {}) => render(
        <MemoryRouter>
            <InformationBox anime={{ ...baseAnime, ...anime }} {...props} />
        </MemoryRouter>
    );

    it('writes an ongoing run as one short line', () => {
        renderBox({ status: 'Airing', release_date: '2026-10-02T12:00:00Z', end_date: null });

        expect(screen.getByText('Since 2 Oct 2026')).toBeInTheDocument();
        expect(screen.queryByText(/to now/)).not.toBeInTheDocument();
    });

    it('stacks a multi-year range under its label and shortens a same-year one', () => {
        const { unmount } = renderBox({ status: 'Finished', release_date: '1999-10-20T12:00:00Z', end_date: '2026-12-18T12:00:00Z' });
        const range = screen.getByText('18 Dec 2026').closest('dd');
        expect(range).toHaveTextContent('20 Oct 1999 – 18 Dec 2026');
        expect(range).not.toHaveClass('text-right');
        unmount();

        renderBox({ status: 'Finished', release_date: '2026-01-05T12:00:00Z', end_date: '2026-03-30T12:00:00Z' });
        const sameYear = screen.getByText('30 Mar 2026').closest('dd');
        expect(sameYear).toHaveTextContent('5 Jan – 30 Mar 2026');
        expect(sameYear).toHaveClass('text-right');
    });

    it('leaves the next episode out when the page shows it elsewhere', () => {
        renderBox(
            { status: 'Airing', next_airing_episode: 8, next_airing_date: new Date(Date.now() + 3600000).toISOString() },
            { showNextEpisode: false },
        );

        expect(screen.queryByText('Next episode')).not.toBeInTheDocument();
    });
});
