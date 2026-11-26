import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Reviews from '../Reviews';
import { renderAdminPage, routeGets } from './communityTestUtils';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const review = {
    id: 5,
    user: { id: 3, username: 'kaito' },
    anime: { id: 9, title: 'Frieren', slug: 'frieren' },
    rating: 9,
    text: 'A quiet, kind show about time.',
    has_spoilers: false,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
};

describe('Reviews', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = { id: 1, username: 'mod', is_staff: true, is_superuser: false };
        routeGets(api.get, {
            reviews: { results: [review], count: 1 },
            'reviews/5': { ...review, text: 'A quiet, kind show about time. The full text.', rating_story: 8 },
        });
    });

    it('opens the review from ?open= in a drawer', async () => {
        renderAdminPage(<Reviews />, { path: '/admin/reviews?open=5' });

        const drawer = await screen.findByRole('dialog', { name: 'Review of Frieren' });
        expect(await within(drawer).findByText('A quiet, kind show about time. The full text.')).toBeInTheDocument();
        expect(within(drawer).getByText('Story')).toBeInTheDocument();
        expect(within(drawer).getByRole('button', { name: 'Mark as spoiler' })).toBeInTheDocument();
    });

    it('toggles the spoiler flag from the drawer', async () => {
        api.post.mockResolvedValue({ ...review, has_spoilers: true });
        renderAdminPage(<Reviews />, { path: '/admin/reviews?open=5' });

        const drawer = await screen.findByRole('dialog', { name: 'Review of Frieren' });
        fireEvent.click(await within(drawer).findByRole('button', { name: 'Mark as spoiler' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('reviews/5/toggle_spoiler'));
    });

    it('gives staff no bulk selection (the bulk API is superuser-only)', async () => {
        renderAdminPage(<Reviews />, { path: '/admin/reviews' });

        expect(await screen.findByRole('button', { name: 'Frieren' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Select all on this page' })).not.toBeInTheDocument();
    });

    it('lets superusers select reviews for bulk actions', async () => {
        auth.user = { id: 1, username: 'root', is_staff: true, is_superuser: true };
        renderAdminPage(<Reviews />, { path: '/admin/reviews' });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row' }));
        expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();
    });

    it('sends filters from the URL and shows a removable author chip', async () => {
        renderAdminPage(<Reviews />, { path: '/admin/reviews?user=3&has_spoilers=true' });

        expect(await screen.findByText('User: kaito')).toBeInTheDocument();
        const [, params] = api.get.mock.calls.find(([path]) => path === 'reviews');
        expect(params).toMatchObject({ user: '3', has_spoilers: 'true', ordering: '-created_at' });
    });
});
