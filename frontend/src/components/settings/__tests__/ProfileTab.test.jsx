import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProfileTab from '../ProfileTab';
import { toneProfileAccentColor } from '../../../utils/profileAccent';

const adult = vi.hoisted(() => ({ value: null }));

vi.mock('../../forums/RichTextEditor', () => ({ default: () => <div data-testid="bio-editor" /> }));
vi.mock('../../common/CustomSelect', () => ({ default: () => <div data-testid="timezone-select" /> }));
vi.mock('../SocialLinksEditor', () => ({ default: () => null }));
vi.mock('../../../hooks/useAdultContentPreference', () => ({ default: () => adult.value }));

const profileState = (overrides = {}) => ({
    bio: '', setBio: vi.fn(),
    username: 'me', setUsername: vi.fn(),
    setAvatarFile: vi.fn(),
    setBannerFile: vi.fn(),
    removeBanner: false, setRemoveBanner: vi.fn(),
    removeAvatar: false, setRemoveAvatar: vi.fn(),
    socialLinks: [], setSocialLinks: vi.fn(),
    profilePrimaryColor: '#8b5cf6', setProfilePrimaryColor: vi.fn(),
    preferredTimezone: 'auto', setPreferredTimezone: vi.fn(),
    isSavingProfile: false,
    profileError: '',
    profileSuccess: '',
    setCropModal: vi.fn(),
    avatarPreviewUrl: null, setAvatarPreviewUrl: vi.fn(),
    bannerPreviewUrl: null, setBannerPreviewUrl: vi.fn(),
    browserTimezone: 'UTC',
    timezoneOptions: [],
    resolvedTimezone: 'UTC',
    timezonePreview: '',
    isBioEdited: false,
    handleSaveProfile: vi.fn(),
    ...overrides,
});

describe('ProfileTab', () => {
    beforeEach(() => {
        adult.value = { enabled: false, toggle: vi.fn().mockResolvedValue(undefined), isUpdating: false };
    });

    it('previews the toned accent and says when it was adjusted', () => {
        render(<ProfileTab user={{ username: 'me' }} profile={profileState({ profilePrimaryColor: '#111111' })} />);

        const toned = toneProfileAccentColor('#111111');
        expect(toned).not.toBe('#111111');
        expect(screen.getByTestId('profile-color-preview')).toHaveStyle({ backgroundColor: toned });
        expect(screen.getByText('Adjusted for readability')).toBeInTheDocument();
    });

    it('says nothing when the picked colour is already readable', () => {
        render(<ProfileTab user={{ username: 'me' }} profile={profileState({ profilePrimaryColor: '#4fa3d1' })} />);

        expect(screen.queryByText('Adjusted for readability')).not.toBeInTheDocument();
    });

    it('labels the username field', () => {
        render(<ProfileTab user={{ username: 'me' }} profile={profileState()} />);

        expect(screen.getByLabelText('Username')).toHaveAttribute('autocapitalize', 'none');
    });

    it('offers "Remove avatar" for a saved avatar and flags it', () => {
        const profile = profileState();
        render(<ProfileTab user={{ username: 'me', avatar: '/a.png' }} profile={profile} />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove avatar' }));

        expect(profile.setRemoveAvatar).toHaveBeenCalledWith(true);
        expect(profile.setAvatarFile).toHaveBeenCalledWith(null);
    });

    it('hides "Remove avatar" when there is none and shows the pending notice with undo', () => {
        const profile = profileState({ removeAvatar: true });
        const { rerender } = render(<ProfileTab user={{ username: 'me' }} profile={profileState()} />);
        expect(screen.queryByRole('button', { name: 'Remove avatar' })).not.toBeInTheDocument();

        rerender(<ProfileTab user={{ username: 'me', avatar: '/a.png' }} profile={profile} />);
        expect(screen.getByText('Avatar will be removed on save')).toBeInTheDocument();
        expect(screen.queryByAltText('Current')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(profile.setRemoveAvatar).toHaveBeenCalledWith(false);
    });

    it('has a Content card with a labelled adult-content switch', () => {
        render(<ProfileTab user={{ username: 'me' }} profile={profileState()} />);

        expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
        const toggle = screen.getByRole('switch', { name: 'Show adult content' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(toggle);
        expect(adult.value.toggle).toHaveBeenCalledTimes(1);
    });

    it('reflects the preference and disables the switch while updating', () => {
        adult.value = { ...adult.value, enabled: true, isUpdating: true };
        render(<ProfileTab user={{ username: 'me' }} profile={profileState()} />);

        const toggle = screen.getByRole('switch', { name: 'Show adult content' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(toggle).toBeDisabled();
    });

    it('shows an error when the preference fails to save', async () => {
        adult.value = { ...adult.value, toggle: vi.fn().mockRejectedValue(new Error('nope')) };
        render(<ProfileTab user={{ username: 'me' }} profile={profileState()} />);

        fireEvent.click(screen.getByRole('switch', { name: 'Show adult content' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not update this setting');
    });
});
