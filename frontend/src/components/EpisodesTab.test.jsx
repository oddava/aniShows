import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import EpisodesTab from './EpisodesTab';

const setProgress = vi.hoisted(() => vi.fn());
const hookState = vi.hoisted(() => ({ entry: { id: null, episodes_watched: 0 }, isPending: false }));
const useListEntryMutation = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useListEntryMutation', () => ({ default: useListEntryMutation }));

beforeEach(() => {
    setProgress.mockReset();
    useListEntryMutation.mockReset();
    useListEntryMutation.mockImplementation(({ entry }) => ({
        ...hookState,
        entry: entry ? { id: entry.id, episodes_watched: entry.episodes_watched } : hookState.entry,
        setProgress,
    }));
});

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

    const episodes = [1, 2, 3].map((number) => ({ ...baseEpisode, number, title: `Episode ${number}` }));
    const renderWithEntry = (props = {}) => render(
        <EpisodesTab
            anime={{ id: 5, slug: 'frieren', title: 'Frieren', duration_minutes: 24, episode_count: 3 }}
            accentColor="#9d7bff"
            episodes={episodes}
            isAuthenticated
            totalCount={3}
            isLoading={false}
            hasError={false}
            hasNextPage={false}
            isFetchingNextPage={false}
            ratingPendingEpisodeNumber={null}
            onRateEpisode={vi.fn()}
            onClearEpisodeRating={vi.fn()}
            onLoadMore={vi.fn()}
            onRetry={vi.fn()}
            {...props}
        />
    );

    it('marks episodes up to the list progress as watched, with text', () => {
        renderWithEntry({ listEntry: { id: 9, status: 'Watching', episodes_watched: 2 } });

        expect(screen.getAllByText('Watched')).toHaveLength(2);
        const rows = screen.getAllByRole('article');
        expect(within(rows[0]).getByText('Watched')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Watched')).toBeInTheDocument();
        expect(within(rows[2]).queryByText('Watched')).not.toBeInTheDocument();
    });

    it('falls back to the anime payload and shows no markers without an entry', () => {
        renderWithEntry({ anime: { id: 5, slug: 'frieren', title: 'Frieren', episode_count: 3 } });

        expect(screen.queryByText('Watched')).not.toBeInTheDocument();
    });

    it('sets progress to the row with "Watched through here"', () => {
        renderWithEntry({ listEntry: { id: 9, status: 'Watching', episodes_watched: 1 } });

        // The row already at the current progress offers nothing to do.
        expect(screen.queryByRole('button', { name: /watched through here \(episode 1\)/i })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /watched through here \(episode 3\)/i }));

        expect(setProgress).toHaveBeenCalledWith(3);
    });

    it('offers no progress control to guests', () => {
        renderWithEntry({ isAuthenticated: false, listEntry: { id: 9, episodes_watched: 1 } });

        expect(screen.queryByRole('button', { name: /watched through here/i })).not.toBeInTheDocument();
    });
});
