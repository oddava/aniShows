import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import UserMenu from '../UserMenu';

const logoutMock = vi.fn();
const notifyMock = vi.fn();

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ logout: logoutMock }),
}));
vi.mock('../../ui/toast', () => ({
    notify: (...args) => notifyMock(...args),
}));

function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>;
}

function Harness({ isAuthenticated = true }) {
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    return (
        <>
            <UserMenu
                user={isAuthenticated ? { username: 'oddava', email: 'someone@example.com' } : null}
                isAuthenticated={isAuthenticated}
                authLoading={false}
                isProfileOpen={isProfileOpen}
                setIsProfileOpen={setIsProfileOpen}
                mobileUnreadCount={0}
                currentUserProfilePath="/u/oddava"
            />
            <a href="/after">After the menu</a>
            <Where />
        </>
    );
}

const renderAt = (path = '/settings', props = {}) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="*" element={<Harness {...props} />} />
        </Routes>
    </MemoryRouter>,
);

describe('UserMenu (desktop account disclosure)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logoutMock.mockResolvedValue(undefined);
    });

    it('returns focus to its button when Escape is pressed inside the open menu', async () => {
        const user = userEvent.setup();
        renderAt();

        const button = screen.getByRole('button', { name: /^oddava, account menu/ });
        await user.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');

        await user.tab();
        expect(screen.getByRole('link', { name: 'Profile' })).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveFocus();
    });

    it('closes when keyboard focus moves past the menu', async () => {
        const user = userEvent.setup();
        renderAt();

        const button = screen.getByRole('button', { name: /^oddava, account menu/ });
        await user.click(button);
        // Profile, Notifications, Settings, Sign out, then out of the menu.
        for (let i = 0; i < 5; i += 1) await user.tab();

        expect(screen.getByRole('link', { name: 'After the menu' })).toHaveFocus();
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('deep-links Settings to the Account tab', async () => {
        const user = userEvent.setup();
        renderAt();

        await user.click(screen.getByRole('button', { name: /^oddava, account menu/ }));
        expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
            'href',
            '/settings?tab=account',
        );
    });

    it('signs out, goes home and says so with the shared toast', async () => {
        const user = userEvent.setup();
        renderAt('/settings');

        await user.click(screen.getByRole('button', { name: /^oddava, account menu/ }));
        await user.click(screen.getByRole('button', { name: 'Sign out' }));

        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(notifyMock).toHaveBeenCalledWith('Signed out.', expect.objectContaining({ id: 'signed-out' }));
    });
});

describe('UserMenu sign-in buttons', () => {
    it('shows Sign in and Create account to guests on ordinary pages', () => {
        renderAt('/browse', { isAuthenticated: false });

        expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
        expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
    });

    it.each([
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        '/reset-password/MQ/abc-123',
        '/verification-pending',
        '/login/',
    ])('hides them on the auth page %s', (path) => {
        renderAt(path, { isAuthenticated: false });

        expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Create account' })).not.toBeInTheDocument();
    });
});
