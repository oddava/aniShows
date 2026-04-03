import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ReviewCard from './ReviewCard';
import { reviewApi } from '../api/client';

vi.mock('../api/client', () => ({
    reviewApi: {
        vote: vi.fn(() => Promise.resolve({ data: {} })),
        react: vi.fn(() => Promise.resolve({ data: {} })),
    },
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({
        user: { username: 'viewer' },
        isAuthenticated: true,
    }),
}));

vi.mock('./common/MiniProfileHoverCard', () => ({
    default: ({ children }) => children,
}));

vi.mock('./common/AnimeMediaImage', () => ({
    default: () => <div data-testid="anime-image" />,
}));

function renderReviewCard(reviewOverrides = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    const review = {
        id: 7,
        created_at: '2026-03-01T12:00:00Z',
        rating: 8,
        text: 'Long review text '.repeat(60),
        has_spoilers: false,
        helpful_count: 3,
        dislike_count: 1,
        user_votes: { helpful: true, dislike: false },
        reactions: [
            { type: 'thumbs_up', emoji: '👍', count: 2, active: false },
            { type: 'heart', emoji: '❤️', count: 4, active: true },
            { type: 'laugh', emoji: '😂', count: 1, active: false },
            { type: 'surprised', emoji: '😮', count: 0, active: false },
            { type: 'sad', emoji: '😢', count: 0, active: false },
        ],
        user: { username: 'author', avatar: null },
        ...reviewOverrides,
    };

    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <ReviewCard review={review} />
            </MemoryRouter>
        </QueryClientProvider>
    );
}

describe('ReviewCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('collapses long reviews and toggles read more state', async () => {
        const user = userEvent.setup();
        renderReviewCard();

        const toggleButton = screen.getByRole('button', { name: 'Read more' });
        expect(toggleButton).toBeInTheDocument();

        await user.click(toggleButton);
        expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    });

    it('sends vote and reaction actions through the updated API', async () => {
        const user = userEvent.setup();
        renderReviewCard();

        await user.click(screen.getByRole('button', { name: /dislike/i }));
        await waitFor(() => {
            expect(reviewApi.vote).toHaveBeenCalledWith(7, 'dislike');
        });

        await user.click(screen.getByText('❤️').closest('button'));
        await waitFor(() => {
            expect(reviewApi.react).toHaveBeenCalledWith(7, 'heart');
        });
    });
});
