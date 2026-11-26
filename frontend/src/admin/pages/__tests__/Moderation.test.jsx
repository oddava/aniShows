import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Moderation from '../Moderation';
import { renderAdminPage, routeGets } from './communityTestUtils';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, username: 'mod', is_staff: true, is_superuser: false } }),
}));

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

const summary = { open_reviews: 1, open_reports: 3, by_reason: { spoiler: 2, spam: 1 }, forums: null };

describe('Moderation', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        routeGets(api.get, {
            'moderation/summary': summary,
            'moderation/reviews': { results: [row], count: 1 },
            'reviews/7': { id: 7, text: 'This ending spoils everything, in full.', rating: 2, has_spoilers: false, created_at: row.created_at, user: row.author, anime: row.anime },
        });
    });

    it('lists open reported reviews with their reasons and the forum note', async () => {
        renderAdminPage(<Moderation />, { path: '/admin/moderation' });

        expect(await screen.findByText('This ending spoils everything')).toBeInTheDocument();
        const reasons = screen.getByRole('list', { name: 'Report reasons' });
        expect(within(reasons).getByText('Spoiler')).toBeInTheDocument();
        expect(within(reasons).getByText('Spam')).toBeInTheDocument();
        expect(screen.getByText('Forum reports are not collected yet')).toBeInTheDocument();

        const [path, params] = api.get.mock.calls.find(([called]) => called === 'moderation/reviews');
        expect(path).toBe('moderation/reviews');
        expect(params).toMatchObject({ status: 'open', page: 1 });
    });

    it('dismisses the reports with the notes the moderator wrote', async () => {
        api.post.mockResolvedValue({ review_id: 7, outcome: 'dismiss', reports_updated: 3 });
        renderAdminPage(<Moderation />, { path: '/admin/moderation' });

        fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
        const dialog = await screen.findByRole('dialog', { name: 'Dismiss these reports?' });
        fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: '  Not a spoiler  ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss reports' }));

        await waitFor(() => expect(api.post).toHaveBeenCalledWith(
            'moderation/reviews/7/resolve',
            { outcome: 'dismiss', notes: 'Not a spoiler' },
        ));
    });

    it('removes the review through the remove_review outcome', async () => {
        api.post.mockResolvedValue({ review_id: 7, outcome: 'remove_review', reports_updated: 3, review_deleted: true });
        renderAdminPage(<Moderation />, { path: '/admin/moderation' });

        fireEvent.click(await screen.findByRole('button', { name: 'Remove review' }));
        const dialog = await screen.findByRole('dialog', { name: 'Remove this review?' });
        const confirm = within(dialog).getByRole('button', { name: 'Remove review' });
        // The author is told why, so a reason is required.
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Reason for the author'), { target: { value: 'Spoils the finale' } });
        fireEvent.click(confirm);

        await waitFor(() => expect(api.post).toHaveBeenCalledWith(
            'moderation/reviews/7/resolve',
            { outcome: 'remove_review', notes: 'Spoils the finale' },
        ));
    });

    it('opens the full review in a drawer', async () => {
        renderAdminPage(<Moderation />, { path: '/admin/moderation' });

        fireEvent.click(await screen.findByRole('button', { name: 'Open review' }));
        const drawer = await screen.findByRole('dialog', { name: 'Review of Frieren' });
        expect(await within(drawer).findByText('This ending spoils everything, in full.')).toBeInTheDocument();
    });

    it('shows no resolve actions on the resolved tab', async () => {
        routeGets(api.get, {
            'moderation/summary': summary,
            'moderation/reviews': { results: [row], count: 1 },
        });
        renderAdminPage(<Moderation />, { path: '/admin/moderation?status=resolved' });

        expect(await screen.findByText('This ending spoils everything')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open review' })).toBeInTheDocument();
    });
});
