import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import OverviewTab from '../OverviewTab';

const fixtures = vi.hoisted(() => ({ summary: null, heatmap: [], watching: [] }));

vi.mock('../../../api/queries/user', () => {
    const q = (key, data) => ({ queryKey: key, queryFn: async () => data() });
    return {
        listQueries: {
            overview: (u, status) => q(['overview', u, status], () => fixtures.watching),
            summary: (u) => q(['summary', u], () => fixtures.summary),
        },
        favoriteQueries: { overview: (u) => q(['favs', u], () => []) },
        characterFavoriteQueries: { overview: (u) => q(['chars', u], () => []) },
        staffFavoriteQueries: { overview: (u) => q(['staff', u], () => []) },
        activityQueries: { heatmap: (u) => q(['heatmap', u], () => fixtures.heatmap) },
    };
});

// The feed and the year grid have their own tests; here only whether they show.
vi.mock('../ActivityFeed', () => ({
    default: ({ header }) => <section data-testid="activity-feed">{header}<p>feed rows</p></section>,
}));
vi.mock('../../ActivityHeatmap', () => ({
    default: () => <div data-testid="heatmap">24 episodes logged this year · 1-day streak</div>,
}));

const today = new Date().toISOString().split('T')[0];

function renderOverview({ summary, heatmap = [{ date: today, count: 24 }], watching = [], isOwnProfile = true, user = {} }) {
    fixtures.summary = summary;
    fixtures.heatmap = heatmap;
    fixtures.watching = watching;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <OverviewTab
                    displayUser={{ username: 'kiyo', ...user }}
                    targetUsername="kiyo"
                    isPrivate={false}
                    isOwnProfile={isOwnProfile}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('OverviewTab with an empty list', () => {
    it('does not claim a year of watching next to "Start your list"', async () => {
        // Activity exists (shows added, then removed), but the list is empty now,
        // and the profile's cached count still says 2.
        renderOverview({ summary: { total: 0, top_genres: [] }, user: { anime_count: 2 } });

        expect(await screen.findByRole('heading', { name: 'Start your list' })).toBeInTheDocument();
        expect(screen.queryByTestId('heatmap')).not.toBeInTheDocument();
        expect(screen.queryByText(/episodes logged this year/)).not.toBeInTheDocument();
        // No feed of adds and removals under "Start your list" either.
        expect(screen.queryByTestId('activity-feed')).not.toBeInTheDocument();
    });

    it('offers both ways to start as two actions, with no dangling "or"', async () => {
        renderOverview({ summary: { total: 0 } });

        const find = await screen.findByRole('link', { name: 'Find something to watch' });
        const importLink = screen.getByRole('link', { name: 'Import a list' });
        expect(find).toHaveAttribute('href', '/browse?sort=trending');
        expect(importLink).toHaveAttribute('href', '/import');
        expect(find.parentElement).toBe(importLink.parentElement);
        expect(find.parentElement.textContent).not.toMatch(/\bor\b/);
    });

    it('tells visitors the list is empty instead of showing the start actions', async () => {
        renderOverview({ summary: { total: 0 }, isOwnProfile: false });

        expect(await screen.findByText('Nothing on kiyo’s list yet.')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Import a list' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('heatmap')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-feed')).not.toBeInTheDocument();
    });
});

describe('OverviewTab with a list', () => {
    it('shows the year of activity and no genre column', async () => {
        renderOverview({
            summary: { total: 7, top_genres: [{ name: 'Fantasy', count: 4 }] },
            watching: [{ id: 1, episodes_watched: 3, anime: { slug: 'blue-box', title: 'Blue Box', episodes: 12 } }],
        });

        expect(await screen.findByTestId('heatmap')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Watching' })).toBeInTheDocument();
        // Genres are a line in the header now, not a half-empty side column.
        expect(screen.queryByRole('heading', { name: 'Top genres' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Start your list' })).not.toBeInTheDocument();
    });
});
