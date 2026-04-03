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
});
