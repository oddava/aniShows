import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ActivityFeed from '../ActivityFeed';

const activityApi = vi.hoisted(() => ({ getFeed: vi.fn(), getHeatmap: vi.fn() }));

vi.mock('../../../api/client', () => ({ activityApi, listApi: {}, reviewApi: {} }));

const activity = (id, overrides = {}) => ({
    id,
    activity_type: 'completed',
    activity_description: `Completed Show ${id}`,
    new_status: 'Completed',
    created_at: new Date().toISOString(),
    anime: { id, slug: `show-${id}`, title: `Show ${id}` },
    ...overrides,
});

function renderFeed() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <ActivityFeed username="kiyo" isPrivate={false} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => activityApi.getFeed.mockReset());

describe('ActivityFeed filters', () => {
    it('sends the list status to the server and renders what it returns', async () => {
        activityApi.getFeed.mockResolvedValueOnce({ data: { next: null, results: [activity(1, { activity_type: 'added', new_status: 'Watching', activity_description: 'Added Show 1 to Watching' })] } });
        renderFeed();
        await screen.findByText('Show 1');
        expect(activityApi.getFeed).toHaveBeenLastCalledWith({ username: 'kiyo', page: 1, page_size: 50 });

        // The server already filtered: rows are shown as returned (no client-side refilter).
        activityApi.getFeed.mockResolvedValueOnce({ data: { next: null, results: [activity(2), activity(3, { new_status: null, old_status: 'Completed', activity_type: 'removed', activity_description: 'Removed Show 3 from list' })] } });
        const completed = screen.getByRole('button', { name: 'Completed' });
        fireEvent.click(completed);

        await waitFor(() => expect(activityApi.getFeed).toHaveBeenLastCalledWith({
            username: 'kiyo', page: 1, page_size: 50, status: 'Completed',
        }));
        expect(await screen.findByText('Show 2')).toBeInTheDocument();
        // Show 3 was removed and is no longer on the list: visitors don't see it.
        expect(screen.queryByText('Show 3')).not.toBeInTheDocument();
        expect(completed).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows the tidied feed: no list churn, one row per burst', async () => {
        const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
        activityApi.getFeed.mockResolvedValueOnce({ data: { next: null, results: [
            activity(1, { created_at: minutesAgo(1), activity_type: 'status_change', old_status: 'Completed', new_status: 'Watching', activity_description: 'Changed Show 1 from Completed to Watching' }),
            activity(2, { created_at: minutesAgo(2), anime: { id: 1, slug: 'show-1', title: 'Show 1' }, old_status: 'Watching', activity_description: 'Completed Show 1' }),
            activity(3, { created_at: minutesAgo(3), activity_type: 'removed', new_status: null, old_status: 'Watching', anime: { id: 9, slug: 'show-9', title: 'Show 9' }, activity_description: 'Removed Show 9 from list' }),
            activity(4, { created_at: minutesAgo(4), activity_type: 'added', new_status: 'Watching', anime: { id: 9, slug: 'show-9', title: 'Show 9' }, activity_description: 'Added Show 9 to Watching' }),
            activity(5, { created_at: minutesAgo(5), activity_description: 'Completed Show 5' }),
        ] } });
        renderFeed();
        expect(await screen.findByText('Show 5')).toBeInTheDocument();
        // Watching → Completed → Watching within a minute nets to nothing.
        expect(screen.queryByText('Show 1')).not.toBeInTheDocument();
        expect(screen.queryByText('Show 9')).not.toBeInTheDocument();
        expect(screen.queryByText(/Removed/)).not.toBeInTheDocument();
    });

    it('uses the display string for multi-word statuses', async () => {
        activityApi.getFeed.mockResolvedValue({ data: { next: null, results: [] } });
        renderFeed();
        fireEvent.click(await screen.findByRole('button', { name: 'Planning' }));
        await waitFor(() => expect(activityApi.getFeed).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'Plan to Watch' }),
        ));
    });
});
