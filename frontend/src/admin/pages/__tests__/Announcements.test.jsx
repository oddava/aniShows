import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Announcements, { announcementState } from '../Announcements';
import { renderPage, STAFF, SUPERUSER } from './peopleTestUtils';

const auth = vi.hoisted(() => ({ user: null }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));

const LIVE = {
    id: 1, title: 'Maintenance on Sunday', body: 'Back by noon.', level: 'warning', is_active: true, show_banner: true,
    starts_at: null, ends_at: null, notified_at: null, notified_count: 0,
};

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.get.mockResolvedValue({ count: 1, results: [LIVE] });
});

describe('announcementState', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    it.each([
        [{ is_active: false }, 'Off'],
        [{ is_active: true, starts_at: '2026-12-01T00:00:00Z' }, 'Scheduled'],
        [{ is_active: true, ends_at: '2026-11-01T00:00:00Z' }, 'Ended'],
        [{ is_active: true, starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' }, 'Live'],
    ])('%j is %s', (item, label) => {
        expect(announcementState(item, now).label).toBe(label);
    });
});

describe('Announcements', () => {
    it('is read-only for staff', async () => {
        auth.user = STAFF;
        renderPage(<Announcements />, { path: '/admin/announcements' });

        expect(await screen.findByText('Maintenance on Sunday')).toBeInTheDocument();
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /New announcement/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    });

    it('sends notifications to the chosen audience', async () => {
        auth.user = SUPERUSER;
        api.post.mockResolvedValue({ message: 'Sending.', estimated_recipients: 3 });
        const user = userEvent.setup();
        renderPage(<Announcements />, { path: '/admin/announcements' });

        await user.click(await screen.findByRole('button', { name: 'Actions for Maintenance on Sunday' }));
        await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Notify members' }));
        const dialog = await screen.findByRole('dialog', { name: 'Notify members' });
        await user.click(within(dialog).getByRole('radio', { name: /Staff only/ }));
        await user.click(within(dialog).getByRole('button', { name: 'Send' }));

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('announcements/1/notify', { audience: 'staff', force: false }));
    });

    it('creates an announcement with ISO dates', async () => {
        auth.user = SUPERUSER;
        api.post.mockResolvedValue({ id: 2 });
        const user = userEvent.setup();
        renderPage(<Announcements />, { path: '/admin/announcements' });

        await user.click(await screen.findByRole('button', { name: /New announcement/ }));
        const dialog = await screen.findByRole('dialog', { name: 'New announcement' });
        await user.type(within(dialog).getByRole('textbox', { name: /Title/ }), 'New season');
        await user.click(within(dialog).getByRole('button', { name: 'Create announcement' }));

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('announcements', expect.objectContaining({
            title: 'New season', level: 'info', is_active: true, show_banner: true, starts_at: null, ends_at: null,
        })));
    });
});
