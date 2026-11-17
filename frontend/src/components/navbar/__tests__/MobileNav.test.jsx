import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MobileNav from '../MobileNav';

function renderNav() {
    return render(
        <MemoryRouter initialEntries={['/browse']}>
            <MobileNav
                user={{ username: 'oddava' }}
                isAuthenticated
                logout={vi.fn()}
                mobileUnreadCount={0}
                currentUserProfilePath="/u/oddava"
            />
            <a href="/after">After the nav</a>
        </MemoryRouter>
    );
}

describe('MobileNav account disclosure', () => {
    it('closes when keyboard focus leaves it and returns focus on Escape', async () => {
        const user = userEvent.setup();
        renderNav();

        const account = screen.getByRole('button', { name: /Account/ });
        await user.click(account);
        expect(account).toHaveAttribute('aria-expanded', 'true');

        // Profile, Settings, Sign Out, then out of the nav.
        for (let i = 0; i < 4; i += 1) await user.tab();
        expect(screen.getByRole('link', { name: 'After the nav' })).toHaveFocus();
        expect(account).toHaveAttribute('aria-expanded', 'false');

        await user.click(account);
        await user.tab();
        await user.keyboard('{Escape}');
        expect(account).toHaveAttribute('aria-expanded', 'false');
        expect(account).toHaveFocus();
    });
});
