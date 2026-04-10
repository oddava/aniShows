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

        expect(screen.getByText('Next Episode')).toBeInTheDocument();
        expect(screen.getByText('Episode 8')).toBeInTheDocument();
    });
});
