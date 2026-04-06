import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EpisodesTab from './EpisodesTab';

const baseEpisode = {
    number: 1,
    title: 'The Journey Begins',
    aired: '2024-01-12',
    thumbnail: '',
    crunchyroll_url: 'https://www.crunchyroll.com/watch/GEXAMPLE',
    has_real_crunchyroll_url: true,
    average_rating: '4.25',
    rating_count: 3,
    user_rating: '4.5',
};

describe('EpisodesTab', () => {
    it('renders public episode rating stats and authenticated controls', () => {
        const onRateEpisode = vi.fn();
        const onClearEpisodeRating = vi.fn();

        render(
            <EpisodesTab
                anime={{ title: 'Frieren', duration_minutes: 24 }}
                accentColor="#9d7bff"
                episodes={[baseEpisode]}
                isAuthenticated
                totalCount={1}
                isLoading={false}
                hasError={false}
                hasNextPage={false}
                isFetchingNextPage={false}
                ratingPendingEpisodeNumber={null}
                onRateEpisode={onRateEpisode}
                onClearEpisodeRating={onClearEpisodeRating}
                onLoadMore={vi.fn()}
                onRetry={vi.fn()}
            />
        );

        expect(screen.getByText('4.25')).toBeInTheDocument();
        expect(screen.getByText('(3)')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /rate episode 1/i }));
        fireEvent.click(screen.getByRole('option', { name: '5.0' }));
        expect(onRateEpisode).toHaveBeenCalledWith(1, '5.0');

        fireEvent.click(screen.getByLabelText(/clear rating for episode 1/i));
        expect(onClearEpisodeRating).toHaveBeenCalledWith(1);
    });

    it('hides rating controls for guests', () => {
        render(
            <EpisodesTab
                anime={{ title: 'Frieren', duration_minutes: 24 }}
                accentColor="#9d7bff"
                episodes={[{ ...baseEpisode, user_rating: null }]}
                isAuthenticated={false}
                totalCount={1}
                isLoading={false}
                hasError={false}
                hasNextPage={false}
                isFetchingNextPage={false}
                ratingPendingEpisodeNumber={null}
                onRateEpisode={vi.fn()}
                onClearEpisodeRating={vi.fn()}
                onLoadMore={vi.fn()}
                onRetry={vi.fn()}
            />
        );

        expect(screen.queryByLabelText(/rate episode 1/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/clear rating for episode 1/i)).not.toBeInTheDocument();
    });
});
