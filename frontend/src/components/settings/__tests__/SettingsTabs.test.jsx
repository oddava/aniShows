import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SettingsTabs from '../SettingsTabs';
import SocialLinksEditor from '../SocialLinksEditor';

vi.mock('../../SmartLinkInput', () => ({
    default: ({ platform, value }) => (
        <div data-testid="smart-link">{`${platform}|${value}`}</div>
    ),
    normalizeUrl: (_platform, value) => value,
}));

describe('SettingsTabs', () => {
    it('offers the badges tab only to users with badges', () => {
        const setActiveTab = vi.fn();
        const { rerender } = render(
            <SettingsTabs user={{ total_badges_count: 0 }} activeTab="profile" setActiveTab={setActiveTab} />
        );
        expect(screen.queryByRole('tab', { name: 'Badges' })).not.toBeInTheDocument();

        rerender(
            <SettingsTabs user={{ total_badges_count: 2 }} activeTab="profile" setActiveTab={setActiveTab} />
        );
        fireEvent.click(screen.getByRole('tab', { name: 'Badges' }));
        expect(setActiveTab).toHaveBeenCalledWith('badges');
    });

    it('is a tablist with a roving tabIndex', () => {
        render(<SettingsTabs user={{}} activeTab="account" setActiveTab={vi.fn()} />);

        expect(screen.getByRole('tablist')).toBeInTheDocument();
        const account = screen.getByRole('tab', { name: 'Account' });
        expect(account).toHaveAttribute('aria-selected', 'true');
        expect(account).toHaveAttribute('tabindex', '0');
        expect(account).toHaveAttribute('aria-controls', 'settings-panel-account');
        const profile = screen.getByRole('tab', { name: 'Profile' });
        expect(profile).toHaveAttribute('aria-selected', 'false');
        expect(profile).toHaveAttribute('tabindex', '-1');
    });

    it.each([
        ['ArrowRight', 'account', 'notifications'],
        ['ArrowRight', 'notifications', 'profile'],
        ['ArrowLeft', 'profile', 'notifications'],
        ['ArrowLeft', 'account', 'profile'],
        ['Home', 'notifications', 'profile'],
        ['End', 'profile', 'notifications'],
    ])('%s from %s selects %s', (key, from, to) => {
        const setActiveTab = vi.fn();
        render(<SettingsTabs user={{}} activeTab={from} setActiveTab={setActiveTab} />);

        fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key });

        expect(setActiveTab).toHaveBeenCalledWith(to);
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
        fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
        expect(setSocialLinks).toHaveBeenCalledWith([{ platform: '', value: '' }]);

        const five = Array.from({ length: 5 }, (_, i) => ({ platform: `p${i}`, value: `v${i}` }));
        rerender(<SocialLinksEditor socialLinks={five} setSocialLinks={setSocialLinks} isSavingProfile={false} />);
        expect(screen.queryByRole('button', { name: 'Add link' })).not.toBeInTheDocument();
        expect(screen.getByText(/Maximum of 5 links reached/)).toBeInTheDocument();
    });
});
