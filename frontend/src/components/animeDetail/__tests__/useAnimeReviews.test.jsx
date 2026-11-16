import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useAnimeReviews from '../useAnimeReviews';
import { reviewApi } from '../../../api/client';
import { reviewKeys } from '../../../api/queries/reviews';

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('../../../api/client', () => ({
    reviewApi: {
        getAll: vi.fn(() => Promise.resolve({ data: { count: 0, next: null, previous: null, results: [] } })),
        getStats: vi.fn(() => Promise.resolve({ data: { total_reviews: 0 } })),
        create: vi.fn(() => Promise.resolve({ data: { id: 1 } })),
        update: vi.fn(() => Promise.resolve({ data: { id: 1 } })),
        delete: vi.fn(() => Promise.resolve({ data: null })),
    },
}));

vi.mock('react-hot-toast', () => ({
    default: { error: mocks.toastError, success: vi.fn() },
}));

const ANIME_DETAIL_KEY = ['anime', 'frieren'];

function setup() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useAnimeReviews({
        slug: 'frieren',
        anime: { title: 'Frieren', user_list_status: 'Watching' },
        user: { username: 'kiyo' },
        isAuthenticated: true,
        queryClient,
        animeDetailQueryKey: ANIME_DETAIL_KEY,
    }), { wrapper });
    return { ...hook, queryClient, invalidateSpy };
}

const invalidatedKeys = (spy) => spy.mock.calls.map(([filters]) => filters?.queryKey);

describe('useAnimeReviews', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes the stats after creating a review', async () => {
        const { result, invalidateSpy } = setup();
        await waitFor(() => expect(reviewApi.getStats).toHaveBeenCalledTimes(1));

        await act(async () => {
            await result.current.handleReviewSubmit({ rating: 8, text: 'Great' });
        });

        expect(reviewApi.create).toHaveBeenCalledWith({ rating: 8, text: 'Great', anime_slug: 'frieren' });
        expect(invalidatedKeys(invalidateSpy)).toContainEqual(reviewKeys.stats('frieren'));
        expect(invalidatedKeys(invalidateSpy)).toContainEqual(reviewKeys.all);
        await waitFor(() => expect(reviewApi.getStats).toHaveBeenCalledTimes(2));
    });

    it('refreshes the stats after editing a review', async () => {
        const { result, invalidateSpy } = setup();
        await waitFor(() => expect(reviewApi.getStats).toHaveBeenCalledTimes(1));

        act(() => result.current.setEditingReview({ id: 5 }));
        await act(async () => {
            await result.current.handleReviewSubmit({ rating: 6 });
        });

        expect(reviewApi.update).toHaveBeenCalledWith(5, { rating: 6 });
        expect(invalidatedKeys(invalidateSpy)).toContainEqual(reviewKeys.stats('frieren'));
    });

    it('refreshes the stats after deleting a review', async () => {
        const { result, invalidateSpy } = setup();
        await waitFor(() => expect(reviewApi.getStats).toHaveBeenCalledTimes(1));

        await act(async () => {
            await result.current.deleteReviewMutation.mutateAsync(5);
        });

        expect(reviewApi.delete).toHaveBeenCalledWith(5);
        expect(invalidatedKeys(invalidateSpy)).toContainEqual(reviewKeys.stats('frieren'));
        await waitFor(() => expect(reviewApi.getStats).toHaveBeenCalledTimes(2));
    });

    it('shows the throttle copy when deleting is rate limited', async () => {
        reviewApi.delete.mockRejectedValueOnce({
            response: { status: 429, data: { detail: 'Request was throttled.', code: 'throttled' } },
        });
        const { result, invalidateSpy } = setup();

        await act(async () => {
            await result.current.deleteReviewMutation.mutateAsync(5).catch(() => {});
        });

        expect(mocks.toastError).toHaveBeenCalledWith('You are doing that too fast. Please wait a moment.');
        expect(invalidatedKeys(invalidateSpy)).not.toContainEqual(reviewKeys.stats('frieren'));
    });
});
