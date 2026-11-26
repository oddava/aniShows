import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import Settings, { changedSettings } from '../Settings';
import { STAFF, SUPERUSER, httpError, renderPage } from './opsTestUtils';

const { api, auth } = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
    auth: { user: null },
}));

vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), adminApi: api }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const SETTINGS = {
    general: { maintenanceMode: false, allowRegistration: true },
    users: { emailVerification: true, allowUsernameChange: true, minUsernameLength: 3, maxUsernameLength: 30 },
    content: { enableReviews: true },
};

const switchFor = (name) => screen.getByRole('switch', { name });

describe('Settings', () => {
    beforeEach(() => {
        Object.values(api).forEach((mock) => mock.mockReset());
        auth.user = SUPERUSER;
        api.get.mockResolvedValue(SETTINGS);
    });

    it('shows the five switches and two number fields the server enforces', async () => {
        renderPage(<Settings />, { path: '/admin/settings' });
        await screen.findByRole('switch', { name: 'Maintenance mode' });
        expect(screen.getAllByRole('switch')).toHaveLength(5);
        expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    });

    it('asks before maintenance mode, then saves only what changed', async () => {
        api.put.mockResolvedValue({ settings: { ...SETTINGS, general: { ...SETTINGS.general, maintenanceMode: true } } });
        renderPage(<Settings />, { path: '/admin/settings' });

        fireEvent.click(await screen.findByRole('switch', { name: 'Maintenance mode' }));
        const dialog = screen.getByRole('dialog', { name: 'Turn on maintenance mode?' });
        expect(within(dialog).getByText(/Staff keep access/)).toBeInTheDocument();
        expect(switchFor('Maintenance mode')).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
        expect(switchFor('Maintenance mode')).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(api.put).toHaveBeenCalledWith('settings', { general: { maintenanceMode: true } }));
    });

    it('turns a switch off without asking and can discard the change', async () => {
        renderPage(<Settings />, { path: '/admin/settings' });
        fireEvent.click(await screen.findByRole('switch', { name: 'Allow new sign-ups' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(switchFor('Allow new sign-ups')).toHaveAttribute('aria-checked', 'true');
        expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    });

    it('shows the server field errors next to the field', async () => {
        api.put.mockRejectedValue(httpError(400, {
            detail: 'Invalid settings payload.',
            errors: { 'users.minUsernameLength': 'Cannot be greater than maxUsernameLength.' },
        }));
        renderPage(<Settings />, { path: '/admin/settings' });
        const min = await screen.findByRole('spinbutton', { name: 'Shortest username' });
        fireEvent.change(min, { target: { value: '40' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(await screen.findByText('Cannot be greater than maxUsernameLength.')).toBeInTheDocument();
        expect(api.put).toHaveBeenCalledWith('settings', { users: { minUsernameLength: 40 } });
    });

    it('is read only for staff', async () => {
        auth.user = STAFF;
        renderPage(<Settings />, { path: '/admin/settings' });
        expect(await screen.findByRole('switch', { name: 'Maintenance mode' })).toBeDisabled();
        expect(screen.getByText('Only superusers can change these settings.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });

    it('computes nested changes', () => {
        expect(changedSettings(SETTINGS, SETTINGS)).toEqual({});
        expect(changedSettings(SETTINGS, { ...SETTINGS, content: { enableReviews: false } })).toEqual({ content: { enableReviews: false } });
    });
});
