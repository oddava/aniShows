import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import SyncHealth from '../SyncHealth';
import { page, renderAdminPage } from './catalogTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: { id: 1, username: 'root', is_staff: true, is_superuser: true } },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/ui/toast', () => ({ notify: vi.fn(), notifyError: vi.fn(), default: vi.fn() }));

const state = {
    id: 5,
    anime: { id: 7, title: 'Frieren', slug: 'frieren', anilist_id: null, mal_id: 52991 },
    metadata_status: 'blocked_no_ids',
    franchise_status: 'pending',
    metadata_attempt_count: 4,
    franchise_attempt_count: 0,
    attempt_count: 4,
    last_attempt_at: '2026-11-20T10:00:00Z',
    next_attempt_at: '2026-11-27T10:00:00Z',
    last_error_code: 'no_match',
    last_error_message: 'AniList returned no match for MAL 52991',
    quarantined: true,
    quarantine_reason: 'no_anilist_match',
    quarantine_context: {},
};

describe('Sync health', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = { id: 1, username: 'root', is_staff: true, is_superuser: true };
        api.get.mockResolvedValue(page([state]));
    });

    it('lists held-back records by default', async () => {
        renderAdminPage(<SyncHealth />, { path: '/admin/sync-health?quarantined=true' });
        expect(await screen.findByText('Frieren')).toBeInTheDocument();
        expect(screen.getByText('No anilist match')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith(
            'offline-sync-states',
            expect.objectContaining({ quarantined: 'true', ordering: 'next_attempt_at' }),
            expect.anything(),
        );
    });

    it('retry posts to the record retry action', async () => {
        api.post.mockResolvedValue({ ...state, quarantined: false });
        renderAdminPage(<SyncHealth />, { path: '/admin/sync-health' });
        fireEvent.click(await screen.findByRole('button', { name: 'Actions for Frieren' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Retry now' }));
        const dialog = await screen.findByRole('dialog', { name: 'Retry now?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('offline-sync-states/5/retry', undefined));
    });

    it('sets ids and retries', async () => {
        api.post.mockResolvedValue(state);
        renderAdminPage(<SyncHealth />, { path: '/admin/sync-health' });
        fireEvent.click(await screen.findByRole('button', { name: 'Actions for Frieren' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Set ids and retry' }));
        const dialog = await screen.findByRole('dialog', { name: 'Set provider ids and retry' });
        fireEvent.change(within(dialog).getByLabelText('AniList id'), { target: { value: '154587' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save and retry' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith(
            'offline-sync-states/5/set_ids_and_retry',
            { anilist_id: 154587, mal_id: 52991 },
        ));
    });

    it('staff can read but not act', async () => {
        auth.user = { id: 2, username: 'mod', is_staff: true, is_superuser: false };
        renderAdminPage(<SyncHealth />, { path: '/admin/sync-health' });
        fireEvent.click(await screen.findByRole('button', { name: 'Actions for Frieren' }));
        expect(await screen.findByRole('menuitem', { name: 'Details' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Retry now' })).toBeNull();
    });
});
