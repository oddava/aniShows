import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminUsers from '../AdminUsers';

const { getMock, postMock, deleteMock, toastSuccess, toastError, role } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    deleteMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    role: { userId: 99, isSuperuser: true, isStaff: true },
}));

vi.mock('../../../api/client', () => ({
    default: {
        get: (...args) => getMock(...args),
        post: (...args) => postMock(...args),
        delete: (...args) => deleteMock(...args),
    },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('../hooks/useAdminRole', () => ({ default: () => role }));

const user = (id, extra = {}) => ({
    id,
    username: `user${id}`,
    email: `user${id}@example.com`,
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: '2026-01-01T00:00:00Z',
    ...extra,
});

const render = (ui) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return rtlRender(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

const pageOf = (url) => new URL(url, 'http://x').searchParams.get('page');

describe('AdminUsers', () => {
    beforeEach(() => {
        getMock.mockReset();
        postMock.mockReset();
        deleteMock.mockReset();
        toastSuccess.mockReset();
        toastError.mockReset();
        role.isSuperuser = true;
    });

    it('goes back to page 1 when the search changes, and debounces it', async () => {
        getMock.mockResolvedValue({ data: { results: [user(1)], count: 60 } });
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByText(/Next/));
        await waitFor(() => expect(pageOf(getMock.mock.calls.at(-1)[0])).toBe('2'));

        const input = screen.getByPlaceholderText(/Search users/);
        fireEvent.change(input, { target: { value: 'a' } });
        fireEvent.change(input, { target: { value: 'al' } });
        fireEvent.change(input, { target: { value: 'ali' } });

        await waitFor(() => {
            const url = getMock.mock.calls.at(-1)[0];
            expect(url).toContain('search=ali');
            expect(pageOf(url)).toBe('1');
        });
        const searched = getMock.mock.calls.filter(([url]) => url.includes('search='));
        expect(searched.every(([url]) => url.includes('search=ali'))).toBe(true);
    });

    it('steps back instead of showing an error when the page no longer exists', async () => {
        getMock.mockImplementation((url) =>
            pageOf(url) === '2'
                ? Promise.reject({ response: { status: 404, data: { detail: 'Invalid page.' } } })
                : Promise.resolve({ data: { results: [user(1)], count: 60 } }),
        );
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByText(/Next/));

        await waitFor(() => expect(pageOf(getMock.mock.calls.at(-1)[0])).toBe('1'));
        expect(screen.queryByText('Error Loading Users')).toBeNull();
        expect(await screen.findByText('user1')).toBeTruthy();
    });

    it('shows staff no Delete or Promote buttons, and no suspend for staff accounts', async () => {
        role.isSuperuser = false;
        getMock.mockResolvedValue({ data: { results: [user(1), user(2, { is_staff: true })], count: 2 } });
        render(<AdminUsers />);
        await screen.findByText('user1');

        expect(screen.queryByRole('button', { name: /Delete user/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Promote/ })).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.getByRole('button', { name: 'Suspend user1' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Suspend user2' })).toBeNull();
    });

    it('requires a reason before suspending', async () => {
        getMock.mockResolvedValue({ data: { results: [user(1)], count: 1 } });
        postMock.mockResolvedValue({ data: { id: 1, username: 'user1', is_active: false, changed: true, message: 'User user1 suspended.' } });
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByRole('button', { name: 'Suspend user1' }));
        const dialog = screen.getByRole('alertdialog', { name: 'Suspend user1?' });
        const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(confirm);
        expect(postMock).not.toHaveBeenCalled();

        fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'ab' } });
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Spam links' } });
        expect(confirm).not.toHaveAttribute('aria-disabled');
        fireEvent.click(confirm);

        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('User user1 suspended.'));
        expect(postMock).toHaveBeenCalledWith('/admin/users/1/suspend/', { reason: 'Spam links' });
    });

    it('sends an explicit is_staff when a superuser promotes', async () => {
        getMock.mockResolvedValue({ data: { results: [user(1)], count: 1 } });
        postMock.mockResolvedValue({ data: { id: 1, is_staff: true, message: 'Promoted.' } });
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByRole('button', { name: 'Promote user1 to staff' }));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Promote' }));

        await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/users/1/toggle_staff/', { is_staff: true }));
    });

    it('opens the user drawer with the moderation history', async () => {
        getMock.mockImplementation((url) => (url === '/admin/users/1/'
            ? Promise.resolve({
                data: {
                    ...user(1, { is_active: false }),
                    favorites_count: 2,
                    reviews_count: 5,
                    list_entries_count: 40,
                    moderation_history: [{ id: 10, action: 'SUSPEND', timestamp: '2026-11-10T00:00:00Z', actor: 'mod', reason: 'Spam links' }],
                },
            })
            : Promise.resolve({ data: { results: [user(1)], count: 1 } })));
        render(<AdminUsers />);
        await screen.findByText('user1');

        fireEvent.click(screen.getByRole('button', { name: 'View user1' }));
        const drawer = await screen.findByRole('dialog', { name: 'user1' });
        expect(await within(drawer).findByText('Spam links')).toBeInTheDocument();
        expect(within(drawer).getByText('40')).toBeInTheDocument();
        expect(within(drawer).getByRole('link', { name: 'All audit entries' }))
            .toHaveAttribute('href', '/admin/logs?tab=audit&entity_type=User&entity_id=1');
    });
});
