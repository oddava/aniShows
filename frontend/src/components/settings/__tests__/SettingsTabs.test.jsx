import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NotificationsTab from '../NotificationsTab';
import SettingsTabs from '../SettingsTabs';
import SocialLinksEditor from '../SocialLinksEditor';

vi.mock('../../SmartLinkInput', () => ({
    default: ({ platform, value }) => (
        <div data-testid="smart-link">{`${platform}|${value}`}</div>
    ),
    normalizeUrl: (_platform, value) => value,
}));

const notificationState = (overrides = {}) => ({
    preferences: {
        email_new_episodes: true,
        push_new_episodes: false,
        push_review_replies: true,
        push_new_follower: false,
    },
    isLoadingPreferences: false,
    isSavingPreferences: false,
    preferencesMessage: '',
    handleTogglePreference: vi.fn(),
    ...overrides,
});

describe('NotificationsTab', () => {
    it('renders one switch per preference with its saved state', () => {
        render(<NotificationsTab notifications={notificationState()} />);

        const switches = screen.getAllByRole('switch');
        expect(switches).toHaveLength(4);
        expect(switches.map((el) => el.getAttribute('aria-checked'))).toEqual([
            'true', 'false', 'true', 'false',
        ]);
        expect(screen.getByRole('switch', { name: 'Review Replies' })).toHaveAttribute('aria-checked', 'true');
    });

    it('calls the toggle handler with the preference key', () => {
        const state = notificationState();
        render(<NotificationsTab notifications={state} />);

        fireEvent.click(screen.getByRole('switch', { name: 'New Followers' }));

        expect(state.handleTogglePreference).toHaveBeenCalledWith('push_new_follower');
    });

    it('disables the switches while saving and shows the message', () => {
        render(
            <NotificationsTab
                notifications={notificationState({
                    isSavingPreferences: true,
                    preferencesMessage: 'Preferences saved successfully',
                })}
            />
        );

        screen.getAllByRole('switch').forEach((el) => expect(el).toBeDisabled());
        expect(screen.getByText('Preferences saved successfully')).toBeInTheDocument();
    });

    it('shows spinners instead of switches while loading', () => {
        render(<NotificationsTab notifications={notificationState({ isLoadingPreferences: true })} />);

        expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });
});

describe('SettingsTabs', () => {
    it('offers the badges tab only to users with badges', () => {
        const setActiveTab = vi.fn();
        const { rerender } = render(
            <SettingsTabs user={{ total_badges_count: 0 }} activeTab="profile" setActiveTab={setActiveTab} />
        );
        expect(screen.queryByRole('button', { name: 'Badges' })).not.toBeInTheDocument();

        rerender(
            <SettingsTabs user={{ total_badges_count: 2 }} activeTab="profile" setActiveTab={setActiveTab} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Badges' }));
        expect(setActiveTab).toHaveBeenCalledWith('badges');
    });
});

describe('SocialLinksEditor', () => {
    it('flags duplicate links and links without a platform', () => {
        render(
            <SocialLinksEditor
                socialLinks={[
                    { platform: 'twitter', value: 'https://twitter.com/me' },
                    { platform: 'twitter', value: 'https://www.twitter.com/me/' },
                    { platform: '', value: 'something' },
                ]}
                setSocialLinks={vi.fn()}
                isSavingProfile={false}
            />
        );

        expect(screen.getAllByText('Duplicate link detected')).toHaveLength(2);
        expect(screen.getAllByText('Platform name is required')).toHaveLength(1);
        expect(screen.getByText('3/5')).toBeInTheDocument();
    });

    it('adds an empty link and hides the button at the limit', () => {
        const setSocialLinks = vi.fn();
        const { rerender } = render(
            <SocialLinksEditor socialLinks={[]} setSocialLinks={setSocialLinks} isSavingProfile={false} />
        );

        expect(screen.getByText('No social links added yet.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Add Link' }));
        expect(setSocialLinks).toHaveBeenCalledWith([{ platform: '', value: '' }]);

        const five = Array.from({ length: 5 }, (_, i) => ({ platform: `p${i}`, value: `v${i}` }));
        rerender(<SocialLinksEditor socialLinks={five} setSocialLinks={setSocialLinks} isSavingProfile={false} />);
        expect(screen.queryByRole('button', { name: 'Add Link' })).not.toBeInTheDocument();
        expect(screen.getByText(/Maximum of 5 links reached/)).toBeInTheDocument();
    });
});
