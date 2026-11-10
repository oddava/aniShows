import { useEffect, useMemo, useState } from 'react';
import { authApi } from '../../api/client';
import { profileKeys } from '../../api/queries/user';
import logger from '../../utils/logger';
import {
    AUTO_TIMEZONE_VALUE,
    formatDateTime,
    formatTimeZoneLabel,
    getBrowserTimeZone,
    getSupportedTimeZones,
    normalizeTimeZonePreference,
} from '../../utils/dateUtils';
import {
    DEFAULT_PROFILE_PRIMARY_COLOR,
    decodeHtmlEntities,
    getResponsiveBannerAspect,
    getSocialLinkDuplicateKey,
    normalizeProfilePrimaryColor,
} from './settingsUtils';

/**
 * Profile-tab form state for the Settings page: the editable fields, the image
 * crop modal, the timezone picker and the save/privacy handlers. It lives in
 * Settings (not the tab) so unsaved edits survive switching tabs.
 */
export default function useProfileSettings({ user, refreshProfile, queryClient }) {
    // Profile settings state
    const [bio, setBio] = useState('');
    const [username, setUsername] = useState('');
    const [avatarFile, setAvatarFile] = useState(null);
    const [bannerFile, setBannerFile] = useState(null);
    const [removeBanner, setRemoveBanner] = useState(false);
    const [socialLinks, setSocialLinks] = useState([]);
    const [isPrivate, setIsPrivate] = useState(false);
    const [profilePrimaryColor, setProfilePrimaryColor] = useState(DEFAULT_PROFILE_PRIMARY_COLOR);
    const [preferredTimezone, setPreferredTimezone] = useState(AUTO_TIMEZONE_VALUE);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');

    // Image Crop Modal State
    const [cropModal, setCropModal] = useState({
        isOpen: false,
        imageSrc: null,
        sourceMimeType: '',
        type: 'avatar' // 'avatar' or 'banner'
    });
    const [bannerCropAspect, setBannerCropAspect] = useState(() => {
        if (typeof window === 'undefined') return getResponsiveBannerAspect(1280);
        return getResponsiveBannerAspect(window.innerWidth);
    });
    // Temporary ObjectURLs for previewing without storing in memory permanently
    const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(null);
    const [bannerPreviewUrl, setBannerPreviewUrl] = useState(null);

    const browserTimezone = useMemo(() => getBrowserTimeZone(), []);
    const supportedTimezones = useMemo(() => getSupportedTimeZones(), []);
    const timezoneOptions = useMemo(
        () => [
            {
                value: AUTO_TIMEZONE_VALUE,
                label: `Use device timezone (${browserTimezone})`,
            },
            ...supportedTimezones.map((timezone) => ({
                value: timezone,
                label: formatTimeZoneLabel(timezone),
            })),
        ],
        [browserTimezone, supportedTimezones]
    );
    const resolvedTimezone = preferredTimezone === AUTO_TIMEZONE_VALUE ? browserTimezone : preferredTimezone;
    const timezonePreview = useMemo(
        () =>
            formatDateTime(
                new Date(),
                {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short',
                },
                preferredTimezone
            ),
        [preferredTimezone]
    );

    // Initialize state from user data
    useEffect(() => {
        if (user) {
            setBio(decodeHtmlEntities(user.bio || ''));
            setUsername(user.username || '');
            // Convert backend 'url' field to frontend 'value' field for compatibility
            const normalizedLinks = (user.social_links || []).map(link => ({
                platform: link.platform || '',
                value: link.value || link.url || ''  // Support both 'value' and 'url' fields
            }));
            setSocialLinks(normalizedLinks);
            setIsPrivate(user.is_private || false);
            setProfilePrimaryColor(normalizeProfilePrimaryColor(user.profile_primary_color));
            setPreferredTimezone(normalizeTimeZonePreference(user.preferred_timezone));
        }
    }, [user]);

    useEffect(() => {
        const handleResize = () => {
            setBannerCropAspect(getResponsiveBannerAspect(window.innerWidth));
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const savedBio = decodeHtmlEntities(user?.bio || '');
    const isBioEdited = bio !== savedBio;

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        setProfileError('');
        setProfileSuccess('');

        // Validate social links before saving
        const nonEmptyLinks = socialLinks.filter(link =>
            link.platform?.trim() || link.value?.trim()
        );

        // Check for empty platform names
        const emptyPlatformLinks = nonEmptyLinks.filter(link => !link.platform?.trim());
        if (emptyPlatformLinks.length > 0) {
            setProfileError('Please provide a platform name for all links');
            setIsSavingProfile(false);
            return;
        }

        // Check for duplicate links
        const dedupeKeys = nonEmptyLinks.map(getSocialLinkDuplicateKey).filter(Boolean);
        const uniqueKeys = new Set(dedupeKeys);
        if (dedupeKeys.length !== uniqueKeys.size) {
            setProfileError('Duplicate links detected. Please remove duplicates before saving.');
            setIsSavingProfile(false);
            return;
        }

        // Check if anything actually changed
        const normalizedUserBio = decodeHtmlEntities(user.bio || '');
        const normalizedCurrentProfileColor = normalizeProfilePrimaryColor(user.profile_primary_color);
        const normalizedSelectedProfileColor = normalizeProfilePrimaryColor(profilePrimaryColor);
        const normalizedCurrentTimezone = normalizeTimeZonePreference(user.preferred_timezone);
        const normalizedSelectedTimezone = normalizeTimeZonePreference(preferredTimezone);
        const hasChanges = (
            bio !== normalizedUserBio ||
            username.trim() !== user.username ||
            JSON.stringify(nonEmptyLinks) !== JSON.stringify(user.social_links || []) ||
            isPrivate !== user.is_private ||
            normalizedSelectedProfileColor !== normalizedCurrentProfileColor ||
            normalizedSelectedTimezone !== normalizedCurrentTimezone ||
            avatarFile !== null ||
            bannerFile !== null ||
            removeBanner
        );

        if (!hasChanges) {
            setProfileSuccess('No changes to save');
            setIsSavingProfile(false);
            return;
        }

        // Optimistic UI update - show success immediately
        setProfileSuccess('Saving...');

        try {
            const formData = new FormData();

            // Only append changed fields
            if (bio !== normalizedUserBio) formData.append('bio', bio);
            if (username.trim() !== user.username) formData.append('username', username.trim());

            // Only send social links if they changed
            const currentLinks = user.social_links || [];
            const linksChanged = JSON.stringify(nonEmptyLinks) !== JSON.stringify(currentLinks);
            if (linksChanged) {
                formData.append('social_links', JSON.stringify(nonEmptyLinks));
            }

            if (isPrivate !== user.is_private) formData.append('is_private', isPrivate);
            // Always send the selected profile color so stale client state cannot drop the field.
            formData.append('profile_primary_color', normalizedSelectedProfileColor);
            if (normalizedSelectedTimezone !== normalizedCurrentTimezone) {
                formData.append('preferred_timezone', normalizedSelectedTimezone);
            }
            if (avatarFile) formData.append('avatar', avatarFile);
            if (bannerFile) formData.append('banner', bannerFile);
            if (removeBanner) formData.append('remove_banner', 'true');

            const response = await authApi.updateProfile(formData);
            const updatedProfile = response?.data;
            const savedProfileColor = normalizeProfilePrimaryColor(
                updatedProfile?.profile_primary_color || normalizedSelectedProfileColor
            );
            setProfileSuccess('Profile updated successfully!');
            setProfilePrimaryColor(savedProfileColor);
            setPreferredTimezone(
                normalizeTimeZonePreference(
                    updatedProfile?.preferred_timezone || normalizedSelectedTimezone
                )
            );

            // Clear file inputs immediately for better UX
            setAvatarFile(null);
            setBannerFile(null);
            setAvatarPreviewUrl(null);
            setBannerPreviewUrl(null);
            setRemoveBanner(false);

            // Use PATCH response as source of truth to avoid stale re-fetch fallback
            if (updatedProfile && typeof updatedProfile === 'object') {
                refreshProfile(updatedProfile);
                queryClient.setQueryData(profileKeys.own, updatedProfile);
            } else {
                refreshProfile();
            }

            // Invalidate React Query profile caches so Profile page shows fresh data
            // (avatar, banner, bio, username changes etc.)
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            queryClient.invalidateQueries({ queryKey: profileKeys.all });
        } catch (err) {
            logger.error('Failed to update profile:', err);
            let msg = 'Failed to update profile';

            if (err.response?.data) {
                const data = err.response.data;
                if (typeof data === 'object') {
                    const firstKey = Object.keys(data)[0];
                    const firstVal = data[firstKey];
                    const errorDetails = Array.isArray(firstVal) ? firstVal[0] : firstVal;
                    msg = `${firstKey}: ${errorDetails}`;
                } else if (typeof data === 'string' && data.length < 100) {
                    msg = data;
                }
            }
            setProfileError(msg);
            setProfileSuccess('');
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handlePrivacyToggle = async () => {
        const newPrivacy = !isPrivate;
        setIsPrivate(newPrivacy);
        try {
            await authApi.updateProfile({ is_private: newPrivacy });
            // Invalidate profile caches since privacy affects public profile visibility
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            queryClient.invalidateQueries({ queryKey: profileKeys.all });
        } catch (err) {
            logger.error('Failed to update privacy:', err);
            setIsPrivate(!newPrivacy); // Revert on failure
        }
    };

    return {
        bio, setBio,
        username, setUsername,
        setAvatarFile,
        setBannerFile,
        removeBanner, setRemoveBanner,
        socialLinks, setSocialLinks,
        isPrivate,
        profilePrimaryColor, setProfilePrimaryColor,
        preferredTimezone, setPreferredTimezone,
        isSavingProfile,
        profileError,
        profileSuccess,
        cropModal, setCropModal,
        bannerCropAspect,
        avatarPreviewUrl, setAvatarPreviewUrl,
        bannerPreviewUrl, setBannerPreviewUrl,
        browserTimezone,
        timezoneOptions,
        resolvedTimezone,
        timezonePreview,
        isBioEdited,
        handleSaveProfile,
        handlePrivacyToggle,
    };
}
