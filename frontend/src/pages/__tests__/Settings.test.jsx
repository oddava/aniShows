import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Settings from '../Settings';

const auth = vi.hoisted(() => ({ value: null }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../../components/SEO', () => ({ default: () => null }));
vi.mock('../../components/ImageCropModal', () => ({ default: () => null }));
vi.mock('../../components/settings/ProfileTab', () => ({ default: () => <div>profile panel</div> }));
vi.mock('../../components/settings/BadgesTab', () => ({ default: () => <div>badges panel</div> }));
vi.mock('../../components/settings/AccountTab', () => ({ default: () => <div>account panel</div> }));
vi.mock('../../components/settings/NotificationsTab', () => ({ default: () => <div>notifications panel</div> }));
vi.mock('../../components/settings/useProfileSettings', () => ({
    default: () => ({ cropModal: { isOpen: false }, isPrivate: false }),
}));
vi.mock('../../components/settings/useAccountSettings', () => ({ default: () => ({}) }));
vi.mock('../../components/settings/useNotificationPreferences', () => ({ default: () => ({}) }));

function Search() {
    const location = useLocation();
    return <div data-testid="search">{location.search}</div>;
}

const renderAt = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Settings />
            <Search />
        </MemoryRouter>,
    );

describe('Settings', () => {
    beforeEach(() => {
        auth.value = {
            user: { username: 'me', total_badges_count: 0 },
            isAuthenticated: true,
            loading: false,
            refreshProfile: vi.fn(),
            logout: vi.fn(),
        };
    });

    it('opens the profile tab by default, as a labelled tabpanel', () => {
        renderAt('/settings');

        const panel = screen.getByRole('tabpanel');
        expect(panel).toHaveTextContent('profile panel');
        expect(panel).toHaveAttribute('id', 'settings-panel-profile');
        expect(panel).toHaveAttribute('aria-labelledby', 'settings-tab-profile');
        expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('id', 'settings-tab-profile');
        expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    });

    it('opens the tab named in ?tab=', () => {
        renderAt('/settings?tab=account');

        expect(screen.getByRole('tabpanel')).toHaveTextContent('account panel');
        expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
    });

    it.each(['bogus', 'badges'])('falls back to profile for ?tab=%s without badges', (tab) => {
        renderAt(`/settings?tab=${tab}`);

        expect(screen.getByRole('tabpanel')).toHaveTextContent('profile panel');
    });

    it('opens badges for a user who has some', () => {
        auth.value.user.total_badges_count = 3;
        renderAt('/settings?tab=badges');

        expect(screen.getByRole('tabpanel')).toHaveTextContent('badges panel');
    });

    it('writes the clicked tab to ?tab= and keeps other params', () => {
        renderAt('/settings?ref=mail');

        fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }));

        expect(screen.getByRole('tabpanel')).toHaveTextContent('notifications panel');
        const params = new URLSearchParams(screen.getByTestId('search').textContent);
        expect(params.get('tab')).toBe('notifications');
        expect(params.get('ref')).toBe('mail');
    });

    it('moves between tabs with the arrow keys and focuses the new tab', () => {
        renderAt('/settings?tab=profile');

        fireEvent.keyDown(screen.getByRole('tab', { name: 'Profile' }), { key: 'ArrowRight' });

        const account = screen.getByRole('tab', { name: 'Account' });
        expect(account).toHaveAttribute('aria-selected', 'true');
        expect(account).toHaveFocus();
        expect(screen.getByTestId('search')).toHaveTextContent('?tab=account');

        fireEvent.keyDown(account, { key: 'ArrowLeft' });
        expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(screen.getByRole('tab', { name: 'Profile' }), { key: 'End' });
        expect(screen.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('aria-selected', 'true');
    });
});
