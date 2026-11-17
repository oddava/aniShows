import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UserMenu from '../UserMenu';

function Harness() {
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    return (
        <MemoryRouter>
            <UserMenu
                user={{ username: 'oddava', email: 'someone@example.com' }}
                isAuthenticated
                authLoading={false}
                logout={vi.fn()}
                isProfileOpen={isProfileOpen}
                setIsProfileOpen={setIsProfileOpen}
                mobileUnreadCount={0}
                currentUserProfilePath="/u/oddava"
            />
            <a href="/after">After the menu</a>
        </MemoryRouter>
    );
}

describe('UserMenu (desktop account disclosure)', () => {
    it('returns focus to its button when Escape is pressed inside the open menu', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        const button = screen.getByRole('button', { name: /Account menu for oddava/ });
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
        render(<Harness />);

        const button = screen.getByRole('button', { name: /Account menu for oddava/ });
        await user.click(button);
        // Profile, Notifications, Settings, Sign Out, then out of the menu.
        for (let i = 0; i < 5; i += 1) await user.tab();

        expect(screen.getByRole('link', { name: 'After the menu' })).toHaveFocus();
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('deep-links Settings to the Account tab', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByRole('button', { name: /Account menu for oddava/ }));
        expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
            'href',
            '/settings?tab=account',
        );
    });
});
