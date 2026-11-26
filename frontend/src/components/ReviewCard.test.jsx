import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReviewCard from './ReviewCard';
import { reviewApi } from '../api/client';
import { reviewKeys } from '../api/queries/reviews';

const mocks = vi.hoisted(() => ({
    auth: { user: { username: 'viewer' }, isAuthenticated: true },
    toastError: vi.fn(),
}));

vi.mock('../api/client', () => ({
    reviewApi: {
        getAll: vi.fn(() => Promise.resolve({ data: { results: [] } })),
        getStats: vi.fn(() => Promise.resolve({ data: {} })),
        vote: vi.fn(() => Promise.resolve({ data: {} })),
        react: vi.fn(() => Promise.resolve({ data: {} })),
        report: vi.fn(() => Promise.resolve({ data: { id: 1, review_id: 7, status: 'open', created: true } })),
    },
}));

vi.mock('react-hot-toast', () => ({
    default: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => mocks.auth,
}));

vi.mock('./common/MiniProfileHoverCard', () => ({
    default: ({ children }) => children,
}));

vi.mock('./common/AnimeMediaImage', () => ({
    default: () => <div data-testid="anime-image" />,
}));

const makeReview = (overrides = {}) => ({
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
    ...overrides,
});

const makeClient = () => new QueryClient({
    defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
    },
});

function renderReviewCard(reviewOverrides = {}, props = {}) {
    const queryClient = makeClient();
    const review = makeReview(reviewOverrides);

    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <ReviewCard review={review} {...props} />
            </MemoryRouter>
        </QueryClientProvider>
    );
}

/** Renders the cards from a cached infinite list, the way the anime page does. */
function CachedReviews({ queryKey }) {
    const { data } = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam }) => reviewApi.getAll({ page: pageParam }).then((res) => res.data),
        initialPageParam: 1,
        getNextPageParam: () => undefined,
        staleTime: Infinity,
    });
    const reviews = data?.pages.flatMap((page) => page.results) || [];
    return reviews.map((review) => <ReviewCard key={review.id} review={review} />);
}

const pagesOf = (...pages) => ({
    pages: pages.map((results) => ({ count: 3, next: null, previous: null, results })),
    pageParams: pages.map((_, index) => index + 1),
});

function renderCachedList() {
    const queryClient = makeClient();
    const activeKey = reviewKeys.forAnime('frieren', 'helpful', null);
    const otherKey = reviewKeys.forAnime('frieren', 'newest', null);
    queryClient.setQueryData(activeKey, pagesOf([makeReview()], [makeReview({ id: 8, user: { username: 'other' } })]));
    // A second loaded list (another sort, two pages) that holds the same review.
    queryClient.setQueryData(otherKey, pagesOf([makeReview({ id: 9, user: { username: 'third' } })], [makeReview()]));

    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <CachedReviews queryKey={activeKey} />
            </MemoryRouter>
        </QueryClientProvider>
    );
    return { queryClient, activeKey, otherKey };
}

const cardFor = (username) => screen.getByRole('link', { name: username }).closest('.bg-dark-100');

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

describe('ReviewCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth = { user: { username: 'viewer' }, isAuthenticated: true };
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

    it('shows only used reactions; the rest come from one picker button', async () => {
        const user = userEvent.setup();
        renderReviewCard();

        // 😮 and 😢 have no reactions yet: no chips for them.
        expect(screen.queryByText('😮')).not.toBeInTheDocument();
        const add = screen.getByRole('button', { name: 'Add a reaction' });
        expect(add).toHaveAttribute('aria-expanded', 'false');

        await user.click(add);
        const picker = screen.getByRole('group', { name: 'Reactions' });
        await user.click(within(picker).getByRole('button', { name: 'Surprised' }));

        await waitFor(() => expect(reviewApi.react).toHaveBeenCalledWith(7, 'surprised'));
        expect(screen.queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument();
        expect(add).toHaveFocus();
    });

    it('closes the reaction picker on Escape and returns focus', async () => {
        const user = userEvent.setup();
        renderReviewCard();

        await user.click(screen.getByRole('button', { name: 'Add a reaction' }));
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add a reaction' })).toHaveFocus();
    });

    it('renders review text exactly as typed, markup and entities included', () => {
        const typed = `I don't <3 it, <img src=x onerror="alert(1)"> &lt;literal&gt;`;
        const { container } = renderReviewCard({ text: typed });

        expect(screen.getByText(typed)).toBeInTheDocument();
        expect(container.querySelector('img[onerror]')).toBeNull();
    });

    it('renders >!spoiler!< text as the shared spoiler button, hidden until activated', async () => {
        const user = userEvent.setup();
        renderReviewCard({ text: 'Before >!<b>Himmel</b> dies!< after' });

        const spoiler = screen.getByRole('button', { name: 'Spoiler, activate to reveal' });
        expect(spoiler).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('<b>Himmel</b> dies')).toBeNull();

        await user.click(spoiler);
        expect(spoiler).toHaveAttribute('aria-expanded', 'true');
        // Plain text: the markup is shown, not parsed.
        expect(screen.getByText('<b>Himmel</b> dies')).toBeInTheDocument();
    });

    it('updates the card optimistically with a single call and no refetch, then reconciles', async () => {
        const user = userEvent.setup();
        const vote = deferred();
        reviewApi.vote.mockReturnValueOnce(vote.promise);
        const { queryClient, otherKey } = renderCachedList();

        const card = cardFor('author');
        await user.click(within(card).getByRole('button', { name: /dislike/i }));

        // Optimistic: helpful vote moves to dislike before the server answers.
        expect(within(card).getByRole('button', { name: /dislike/i })).toHaveAttribute('aria-pressed', 'true');
        expect(within(card).getByRole('button', { name: /dislike/i })).toHaveTextContent('(2)');
        expect(within(card).getByRole('button', { name: /helpful/i })).toHaveTextContent('(2)');
        // The other loaded list (page 2) is patched in place too.
        expect(queryClient.getQueryData(otherKey).pages[1].results[0].dislike_count).toBe(2);

        await act(async () => {
            vote.resolve({
                data: {
                    active: true,
                    vote_type: 'dislike',
                    helpful_count: 5,
                    dislike_count: 6,
                    user_votes: { helpful: false, dislike: true },
                    reactions: makeReview().reactions,
                },
            });
        });

        await waitFor(() => {
            expect(within(card).getByRole('button', { name: /dislike/i })).toHaveTextContent('(6)');
        });
        expect(within(card).getByRole('button', { name: /helpful/i })).toHaveTextContent('(5)');
        expect(reviewApi.vote).toHaveBeenCalledTimes(1);
        expect(reviewApi.getAll).not.toHaveBeenCalled();
        // The unrelated review keeps its counts.
        expect(within(cardFor('other')).getByRole('button', { name: /helpful/i })).toHaveTextContent('(3)');
    });

    it('rolls a failed vote back and shows the error', async () => {
        const user = userEvent.setup();
        reviewApi.vote.mockRejectedValueOnce({
            response: { status: 429, data: { detail: 'Request was throttled.', code: 'throttled' } },
        });
        const { queryClient, otherKey } = renderCachedList();

        const card = cardFor('author');
        await user.click(within(card).getByRole('button', { name: /dislike/i }));

        await waitFor(() => {
            expect(mocks.toastError).toHaveBeenCalledWith('You are doing that too fast. Please wait a moment.');
        });
        expect(within(card).getByRole('button', { name: /dislike/i })).toHaveTextContent('(1)');
        expect(within(card).getByRole('button', { name: /dislike/i })).toHaveAttribute('aria-pressed', 'false');
        expect(within(card).getByRole('button', { name: /helpful/i })).toHaveTextContent('(3)');
        expect(queryClient.getQueryData(otherKey).pages[1].results[0].helpful_count).toBe(3);
        expect(reviewApi.getAll).not.toHaveBeenCalled();
    });

    it('toggles a reaction optimistically and rolls it back on error', async () => {
        const user = userEvent.setup();
        reviewApi.react.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Boom', code: 'error' } } });
        renderCachedList();

        const card = cardFor('author');
        const thumbs = within(card).getByText('👍').closest('button');
        await user.click(thumbs);

        await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Boom'));
        expect(within(card).getByText('👍').closest('button')).toHaveTextContent('2');
        expect(within(card).getByText('👍').closest('button')).toHaveAttribute('aria-pressed', 'false');
    });

    it('disables votes and reactions on your own review', () => {
        mocks.auth = { user: { username: 'author' }, isAuthenticated: true };
        renderReviewCard();

        expect(screen.getByRole('button', { name: /helpful/i })).toBeDisabled();
        expect(screen.getByText('❤️').closest('button')).toBeDisabled();
    });

    it('opens the options menu as a disclosure; Escape closes it and returns focus', async () => {
        const user = userEvent.setup();
        renderReviewCard();

        const trigger = screen.getByRole('button', { name: 'Review options' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await user.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('menu')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Report' })).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();

        await user.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('asks before deleting your own review', async () => {
        const user = userEvent.setup();
        mocks.auth = { user: { username: 'author' }, isAuthenticated: true };
        const onDelete = vi.fn();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        renderReviewCard({}, { onDelete, onEdit: vi.fn() });

        expect(screen.queryByRole('menuitem', { name: 'Report' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Review options' }));
        expect(screen.queryByRole('menuitem', { name: 'Report' })).toBeNull();
        await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(onDelete).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Review options' }));
        await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
        expect(onDelete).toHaveBeenCalledWith(7);
    });

    it('reports a review with a reason and a note', async () => {
        const user = userEvent.setup();
        renderReviewCard();

        await user.click(screen.getByRole('button', { name: 'Review options' }));
        await user.click(screen.getByRole('menuitem', { name: 'Report' }));

        const dialog = screen.getByRole('dialog', { name: 'Report review' });
        const submit = within(dialog).getByRole('button', { name: 'Report' });
        expect(submit).toBeDisabled();

        await user.click(within(dialog).getByRole('button', { name: 'Reason' }));
        await user.click(within(dialog).getByRole('option', { name: 'Spam' }));
        // One paste instead of 28 keystrokes: same input, and the test stays fast on a busy machine.
        await user.click(within(dialog).getByLabelText('Note (optional)'));
        await user.paste('  Same text on every anime  ');
        await user.click(submit);

        expect(reviewApi.report).toHaveBeenCalledWith(7, { reason: 'spam', description: 'Same text on every anime' });
        expect(await within(dialog).findByText("Thanks, we'll take a look.")).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('button', { name: 'Review options' })).toHaveFocus();
    });

    it('says so when the review was already reported, and Escape closes the dialog', async () => {
        const user = userEvent.setup();
        reviewApi.report.mockResolvedValueOnce({ data: { id: 1, review_id: 7, status: 'open', created: false } });
        renderReviewCard();

        await user.click(screen.getByRole('button', { name: 'Review options' }));
        await user.click(screen.getByRole('menuitem', { name: 'Report' }));
        const dialog = screen.getByRole('dialog', { name: 'Report review' });
        await user.click(within(dialog).getByRole('button', { name: 'Reason' }));
        await user.click(within(dialog).getByRole('option', { name: 'Other' }));
        await user.click(within(dialog).getByRole('button', { name: 'Report' }));

        expect(await within(dialog).findByText("You've already reported this review.")).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows the envelope message when a report fails', async () => {
        const user = userEvent.setup();
        reviewApi.report.mockRejectedValueOnce({
            response: { status: 429, data: { detail: 'You have reached the daily report limit.', code: 'report_limit' } },
        });
        renderReviewCard();

        await user.click(screen.getByRole('button', { name: 'Review options' }));
        await user.click(screen.getByRole('menuitem', { name: 'Report' }));
        const dialog = screen.getByRole('dialog', { name: 'Report review' });
        await user.click(within(dialog).getByRole('button', { name: 'Reason' }));
        await user.click(within(dialog).getByRole('option', { name: 'Spam' }));
        await user.click(within(dialog).getByRole('button', { name: 'Report' }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent('You have reached the daily report limit.');
    });

    it('works with the compact anime shape when showing the anime', () => {
        renderReviewCard({
            anime: { id: 1, title: 'Frieren', title_jp: null, slug: 'frieren', cover_image: null, cover_image_small: null, rating: 9.1 },
        }, { showAnime: true });

        expect(screen.getByRole('link', { name: 'Frieren' })).toHaveAttribute('href', '/anime/frieren');
    });

    it('hides the options menu from signed-out visitors', () => {
        mocks.auth = { user: null, isAuthenticated: false };
        renderReviewCard();
        expect(screen.queryByRole('button', { name: 'Review options' })).toBeNull();
    });
});
