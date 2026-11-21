import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusDistribution from './StatusDistribution';
import StatsTab from './StatsTab';

describe('StatusDistribution', () => {
    it('renders its own title', () => {
        render(
            <StatusDistribution
                anime={{
                    status_distribution: {
                        plan_to_watch: 5,
                        watching: 7,
                        on_hold: 3,
                        completed: 2,
                        dropped: 1,
                    },
                }}
            />
        );

        expect(screen.getByText('Status distribution')).toBeInTheDocument();
    });

    it('renders compact counts from canonical snake_case status keys', () => {
        render(
            <StatusDistribution
                anime={{
                    status_distribution: {
                        plan_to_watch: 55000,
                        watching: 7,
                        on_hold: 3,
                        completed: 2,
                        dropped: 1,
                    },
                }}
            />
        );

        expect(screen.getByText('55k')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });
});

describe('StatusDistribution sources (D-3)', () => {
    it('reads AniList-style keys and labels them "On AniList"', () => {
        render(
            <StatusDistribution
                anime={{
                    status_distribution: {
                        CURRENT: 40, REPEATING: 2, PLANNING: 11, PAUSED: 4, COMPLETED: 9, DROPPED: 6,
                    },
                }}
            />
        );

        expect(screen.getByText('On AniList')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('11')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.getByText('9')).toBeInTheDocument();
        expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('renders an explicit distribution with its own label', () => {
        render(
            <StatusDistribution
                anime={{ status_distribution: { watching: 999 } }}
                distribution={{ watching: 3, completed: 1 }}
                sourceLabel="On AniShows"
            />
        );

        expect(screen.getByText('On AniShows')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.queryByText('999')).not.toBeInTheDocument();
    });
});

describe('StatsTab', () => {
    it('shows AniShows members next to AniList members when the payload has them', () => {
        render(
            <StatsTab
                accentColor="#fff"
                anime={{
                    status_distribution: { CURRENT: 120, COMPLETED: 30 },
                    site_status_distribution: { watching: 4, completed: 2, on_hold: 0, dropped: 0, plan_to_watch: 1 },
                }}
            />
        );

        expect(screen.getByText('On AniList')).toBeInTheDocument();
        expect(screen.getByText('On AniShows')).toBeInTheDocument();
    });

    it('shows only the AniList card while site counts are absent', () => {
        render(<StatsTab accentColor="#fff" anime={{ status_distribution: { watching: 1 } }} />);

        expect(screen.getByText('On AniList')).toBeInTheDocument();
        expect(screen.queryByText('On AniShows')).not.toBeInTheDocument();
    });

    it('computes total members from site status distribution values only', () => {
        render(
            <StatsTab
                accentColor="#fff"
                anime={{
                    status_distribution: {
                        watching: 12,
                        plan_to_watch: 5,
                        on_hold: 2,
                        completed: 3,
                        dropped: 1,
                    },
                    member_count: 45678,
                    rating: '8.5',
                    popularity_rank: 10,
                    site_rank: 20,
                }}
            />
        );

        const label = screen.getByText('Total members');
        expect(label.previousElementSibling).toHaveTextContent('23');
    });

    it('shows compact totals for larger site counts', () => {
        render(
            <StatsTab
                accentColor="#fff"
                anime={{
                    status_distribution: {
                        watching: 55667,
                        plan_to_watch: 1,
                        on_hold: 0,
                        completed: 0,
                        dropped: 0,
                    },
                    rating: '8.5',
                    popularity_rank: 10,
                    site_rank: 20,
                }}
            />
        );

        const label = screen.getByText('Total members');
        expect(label.previousElementSibling).toHaveTextContent('55k');
    });
});
