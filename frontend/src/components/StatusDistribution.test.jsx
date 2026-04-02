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

        expect(screen.getByText('Status Distribution')).toBeInTheDocument();
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

describe('StatsTab', () => {
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

        const label = screen.getByText('Total Members');
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

        const label = screen.getByText('Total Members');
        expect(label.previousElementSibling).toHaveTextContent('55k');
    });
});
