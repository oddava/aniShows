import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminSettings, { describeSettingsErrors } from '../AdminSettings';

const { getMock, putMock, toastSuccess, role } = vi.hoisted(() => ({
    getMock: vi.fn(),
    putMock: vi.fn(),
    toastSuccess: vi.fn(),
    role: { userId: 1, isSuperuser: true, isStaff: true },
}));

vi.mock('../../../api/client', () => ({
    default: { get: (...args) => getMock(...args), put: (...args) => putMock(...args) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => role }));

const SETTINGS = {
    general: { maintenanceMode: false, allowRegistration: true },
    users: { emailVerification: true, allowUsernameChange: true, minUsernameLength: 3, maxUsernameLength: 30 },
    content: { enableReviews: true },
};

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><AdminSettings /></QueryClientProvider>);
};

describe('AdminSettings', () => {
    beforeEach(() => {
        role.isSuperuser = true;
        getMock.mockReset();
        putMock.mockReset();
        toastSuccess.mockReset();
        getMock.mockResolvedValue({ data: SETTINGS });
    });

    it('shows exactly the seven enforced settings', async () => {
        renderPage();
        await screen.findByLabelText('Maintenance mode');
        expect(screen.getAllByRole('checkbox')).toHaveLength(5);
        expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
        expect(screen.queryByText(/Two-factor|Site Name|Timezone/i)).toBeNull();
    });

    it('confirms maintenance mode, explaining that staff keep access, then saves', async () => {
        putMock.mockResolvedValue({ data: { settings: { ...SETTINGS, general: { ...SETTINGS.general, maintenanceMode: true } } } });
        renderPage();
        fireEvent.click(await screen.findByLabelText('Maintenance mode'));

        const dialog = screen.getByRole('alertdialog', { name: 'Turn on maintenance mode?' });
        expect(within(dialog).getByText(/Staff keep access/)).toBeInTheDocument();
        expect(screen.getByLabelText('Maintenance mode')).not.toBeChecked();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
        expect(screen.getByLabelText('Maintenance mode')).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Settings saved successfully'));
        expect(putMock).toHaveBeenCalledWith('/admin/settings/', {
            ...SETTINGS,
            general: { ...SETTINGS.general, maintenanceMode: true },
        });
    });

    it('is read-only for staff', async () => {
        role.isSuperuser = false;
        renderPage();
        expect(await screen.findByLabelText('Maintenance mode')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    });

    it('names the refused fields in the error message', () => {
        expect(describeSettingsErrors({
            'users.minUsernameLength': 'Cannot be greater than maxUsernameLength.',
            general: 'Unknown settings section.',
        })).toBe('Minimum username length: Cannot be greater than maxUsernameLength. Site: Unknown settings section.');
        expect(describeSettingsErrors(undefined)).toBe('');
    });
});

