import { describe, it, expect, vi } from 'vitest';
import { cloneElement } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ProfileInsights from '../ProfileInsights';

const summary = vi.hoisted(() => ({ current: null }));

vi.mock('../../api/queries/lists', () => ({
    listQueries: { summary: (u) => ({ queryKey: ['summary', u], queryFn: async () => summary.current }) },
}));

// jsdom has no layout: give the chart a fixed size instead of measuring.
vi.mock('recharts', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ResponsiveContainer: ({ children }) => cloneElement(children, { width: 400, height: 224 }),
    };
});

function renderInsights(data) {
    summary.current = data;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <ProfileInsights username="kiyo" isPrivate={false} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('ProfileInsights score histogram', () => {
    it('scales to the largest count and labels each scored bar instead of drawing a 0–4 axis', async () => {
        const { container } = renderInsights({
            total: 7,
            episodes_watched: 62,
            mean_score: 7.7,
            rated_count: 3,
            score_histogram: { 6: 1, 8: 1, 9: 1 },
        });

        await screen.findByRole('heading', { name: 'Scores' });

        // No y-axis ticks at all.
        expect(container.querySelector('.recharts-yAxis')).toBeNull();

        // One "1" label per scored bar, none for the empty scores.
        const labels = [...container.querySelectorAll('.recharts-label-list text')]
            .map((node) => node.textContent)
            .filter(Boolean);
        expect(labels).toEqual(['1', '1', '1']);

        // Every count is the maximum, so every scored bar is full height.
        const heights = [...container.querySelectorAll('.recharts-bar-rectangle path')]
            .map((node) => Number(node.getAttribute('height')))
            .filter((height) => height > 0);
        expect(heights).toHaveLength(3);
        const plotHeight = Math.max(...heights);
        heights.forEach((height) => expect(height).toBeCloseTo(plotHeight));
        expect(plotHeight).toBeGreaterThan(100);
    });
});

describe('ProfileInsights numbers', () => {
    it('does not repeat the header totals and words the score as an average', async () => {
        renderInsights({
            total: 7,
            episodes_watched: 64,
            mean_score: 7.8,
            rated_count: 3,
            counts: { Watching: 3, Completed: 4 },
            score_histogram: { 6: 1, 8: 1, 9: 1 },
        });

        await screen.findByRole('heading', { name: 'Scores' });
        expect(screen.getByText('Average 7.8 from 3 scores')).toBeInTheDocument();
        expect(screen.queryByText('episodes watched')).not.toBeInTheDocument();
        expect(screen.queryByText('on the list')).not.toBeInTheDocument();
        expect(screen.queryByText(/mean score|rated$/i)).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'By status' })).toBeInTheDocument();
    });
});
