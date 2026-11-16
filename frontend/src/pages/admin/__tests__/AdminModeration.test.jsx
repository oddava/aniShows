import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminModeration from '../AdminModeration';

const { getMock, postMock, toastSuccess, toastError } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('../../../api/client', () => ({
    default: {
        get: (...args) => getMock(...args),
        post: (...args) => postMock(...args),
    },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const row = {
    review_id: 7,
    snippet: 'This ending spoils everything',
    rating: 2,
    has_spoilers: false,
    created_at: '2026-11-01T10:00:00Z',
    author: { id: 3, username: 'kaito' },
    anime: { id: 9, title: 'Frieren', slug: 'frieren' },
    report_counts: { spoiler: 2, spam: 1 },
    report_total: 3,
    reporter_count: 3,
    first_reported_at: '2026-11-02T10:00:00Z',
    last_reported_at: '2026-11-03T10:00:00Z',
    signals: [],
};

let summary;
const mockGets = () => {
    getMock.mockImplementation((url) => {
        if (url.startsWith('/admin/moderation/summary/')) return Promise.resolve({ data: summary });
        if (url.startsWith('/admin/moderation/reviews/')) {
            return Promise.resolve({ data: { results: [row], count: 1 } });
        }
        if (url.startsWith('/admin/moderation/forums/')) {
            return Promise.resolve({
                data: { results: [{ id: 41, kind: 'forum_post', snippet: 'Buy cheap coins', author: 'spammer', reasons: { spam: 4 } }], count: 1 },
            });
        }
        return Promise.reject(new Error(`unexpected ${url}`));
    });
};

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <AdminModeration />
            </MemoryRouter>
        </QueryClientProvider>,
    );
};

const listCalls = () => getMock.mock.calls.filter(([url]) => url.startsWith('/admin/moderation/reviews/'));

describe('AdminModeration', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
        toastSuccess.mockReset();
        toastError.mockReset();
        summary = { open_reviews: 1, open_reports: 3, by_reason: { spoiler: 2, spam: 1 }, forums: null };
        mockGets();
    });

    it('lists the open reported reviews with their reasons', async () => {
        renderPage();

        expect(await screen.findByText('This ending spoils everything')).toBeInTheDocument();
        expect(listCalls()[0][0]).toBe('/admin/moderation/reviews/?page=1&status=open');
        const reasons = screen.getByRole('list', { name: 'Report reasons' });
        expect(within(reasons).getByText('Spoiler')).toBeInTheDocument();
        expect(within(reasons).getByText('Spam')).toBeInTheDocument();
        expect(screen.getByText(/3 open reports on 1 review/)).toBeInTheDocument();
        // Forum reports are not available yet, so there is no tab for them.
        expect(screen.queryByRole('tab', { name: /Forums/ })).toBeNull();
    });

    it.each([
        ['Dismiss', 'dismiss', 'Reports dismissed'],
        ['Mark spoiler', 'mark_spoiler', 'Review marked as a spoiler'],
        ['Remove review', 'remove_review', 'Review removed'],
    ])('%s posts outcome %s, refetches and toasts', async (label, outcome, message) => {
        postMock.mockResolvedValue({ data: { review_id: 7, outcome, reports_updated: 3 } });
        renderPage();
        await screen.findByText('This ending spoils everything');
        const callsBefore = listCalls().length;

        fireEvent.click(screen.getByRole('button', { name: label }));
        const dialog = await screen.findByRole('alertdialog');
        if (outcome === 'remove_review') {
            fireEvent.change(within(dialog).getByLabelText(/Notes/), { target: { value: 'Rule 3' } });
        }
        fireEvent.click(within(dialog).getByRole('button', { name: label }));

        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(message));
        expect(postMock).toHaveBeenCalledWith(
            '/admin/moderation/reviews/7/resolve/',
            outcome === 'remove_review' ? { outcome, notes: 'Rule 3' } : { outcome },
        );
        await waitFor(() => expect(listCalls().length).toBeGreaterThan(callsBefore));
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('shows the API error and keeps the dialog open when a resolve fails', async () => {
        postMock.mockRejectedValue({ response: { status: 409, data: { detail: 'No open reports for this review.' } } });
        renderPage();
        await screen.findByText('This ending spoils everything');

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        const dialog = await screen.findByRole('alertdialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('No open reports for this review.'));
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('opts into heuristic signals only on request', async () => {
        renderPage();
        await screen.findByText('This ending spoils everything');

        fireEvent.click(screen.getByRole('checkbox', { name: /quality signals/ }));
        await waitFor(() => expect(listCalls().at(-1)[0]).toBe('/admin/moderation/reviews/?page=1&status=open&signals=1'));
    });

    it('adds a Forums tab once forum reports exist', async () => {
        summary = { ...summary, forums: { open: 4 } };
        renderPage();

        const tab = await screen.findByRole('tab', { name: 'Forums (4)' });
        fireEvent.click(tab);
        expect(await screen.findByText('Buy cheap coins')).toBeInTheDocument();
        expect(tab).toHaveAttribute('aria-selected', 'true');
    });
});
