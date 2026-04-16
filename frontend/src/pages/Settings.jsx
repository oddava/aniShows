import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Eye, EyeOff, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authApi, notificationApi } from '../api/client';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import logger from '../utils/logger';
import SmartLinkInput, { normalizeUrl } from '../components/SmartLinkInput';
import RichTextEditor from '../components/forums/RichTextEditor';
import ImageCropModal from '../components/ImageCropModal';
import BadgesSettings from '../components/profile/BadgesSettings';
import CustomSelect from '../components/common/CustomSelect';
import {
    AUTO_TIMEZONE_VALUE,
    formatDateTime,
    formatTimeZoneLabel,
    getBrowserTimeZone,
    getSupportedTimeZones,
    normalizeTimeZonePreference,
} from '../utils/dateUtils';

function getResponsiveBannerAspect(width) {
    const safeWidth = Math.max(320, Number(width) || 320);

    // Keep this in sync with ProfileHeader + Settings banner preview classes.
    if (safeWidth >= 1536) return 5.8;
    if (safeWidth >= 1280) return 5.2;
    if (safeWidth >= 1024) return 4.9;
    if (safeWidth >= 768) return 4.6;
    if (safeWidth >= 640) return 3.8;
    return 3.2;
}

function decodeHtmlEntities(text = '') {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&');
}

function canonicalizeSocialUrl(url = '') {
    const trimmed = String(url).trim();
    if (!trimmed) return '';

    const normalizedProtocol = trimmed.replace(/^http:\/\//i, 'https://');

    try {
        const parsed = new URL(normalizedProtocol);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const path = parsed.pathname.replace(/\/+$/, '');
        const search = parsed.search || '';
        return `https://${host}${path}${search}`;
    } catch {
        return normalizedProtocol.toLowerCase().replace(/\/+$/, '');
    }
}

function getSocialLinkDuplicateKey(link = {}) {
    const platform = link.platform?.trim().toLowerCase() || '';
    const value = link.value?.trim() || '';
    if (!value) return '';

    const normalized = normalizeUrl(platform, value).trim();
    const lowered = normalized.toLowerCase();

    if (lowered.startsWith('http://') || lowered.startsWith('https://')) {
        return `url:${canonicalizeSocialUrl(lowered)}`;
    }

    return `platform:${platform}|value:${value.toLowerCase()}`;
}

const DEFAULT_PROFILE_PRIMARY_COLOR = '#75698d';
const PROFILE_COLOR_PRESETS = [
    '#75698d',
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#ec4899',
];

function normalizeProfilePrimaryColor(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_PROFILE_PRIMARY_COLOR;
}

export default function Settings() {
    const { user, isAuthenticated, loading, refreshProfile, logout } = useAuth();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState('profile');

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

    // Account settings state
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [isSavingAccount, setIsSavingAccount] = useState(false);
    const [accountError, setAccountError] = useState('');
    const [accountSuccess, setAccountSuccess] = useState('');

    // Additional Account States
    const [isResending, setIsResending] = useState(false);
    const [changeEmail, setChangeEmail] = useState('');
    const [changeEmailPassword, setChangeEmailPassword] = useState('');
    const [isChangingEmail, setIsChangingEmail] = useState(false);
    const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Notification preferences state
    const [preferences, setPreferences] = useState({
        email_new_episodes: true,
        push_new_episodes: true,
        push_review_replies: true,
        push_new_follower: true,
    });
    const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);
    const [isSavingPreferences, setIsSavingPreferences] = useState(false);
    const [preferencesMessage, setPreferencesMessage] = useState('');
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

    // Redirect from badges tab if user has no badges
    useEffect(() => {
        if (activeTab === 'badges' && user && !user.total_badges_count) {
            setActiveTab('profile');
        }
    }, [activeTab, user]);

    useEffect(() => {
        const handleResize = () => {
            setBannerCropAspect(getResponsiveBannerAspect(window.innerWidth));
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Load notification preferences
    useEffect(() => {
        if (!user) return;

        const fetchPreferences = async () => {
            try {
                const response = await notificationApi.getPreferences();
                setPreferences(response.data);
            } catch (error) {
                logger.error('Failed to fetch preferences:', error);
            } finally {
                setIsLoadingPreferences(false);
            }
        };

        fetchPreferences();
    }, [user]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

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
                queryClient.setQueryData(['ownProfile'], updatedProfile);
            } else {
                refreshProfile();
            }

            // Invalidate React Query profile caches so Profile page shows fresh data
            // (avatar, banner, bio, username changes etc.)
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            queryClient.invalidateQueries({ queryKey: ['profile'] });
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

    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            setAccountError('New passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            setAccountError('Password must be at least 8 characters');
            return;
        }

        setIsSavingAccount(true);
        setAccountError('');
        setAccountSuccess('');
        try {
            await authApi.changePassword({
                old_password: oldPassword,
                new_password: newPassword
            });
            setAccountSuccess('Password changed successfully!');
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            logger.error('Failed to change password:', err);
            let msg = 'Failed to change password';
            if (err.response?.data) {
                const data = err.response.data;
                if (typeof data === 'object') {
                    // Flatten all field errors into one string
                    msg = Object.entries(data)
                        .map(([key, val]) => `${key}: ${Array.isArray(val) ? val[0] : val}`)
                        .join(' | ');
                } else if (typeof data === 'string') {
                    msg = data.substring(0, 100);
                }
            }
            setAccountError(msg);
        } finally {
            setIsSavingAccount(false);
        }
    };

    const handlePrivacyToggle = async () => {
        const newPrivacy = !isPrivate;
        setIsPrivate(newPrivacy);
        try {
            await authApi.updateProfile({ is_private: newPrivacy });
            // Invalidate profile caches since privacy affects public profile visibility
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            queryClient.invalidateQueries({ queryKey: ['profile'] });
        } catch (err) {
            logger.error('Failed to update privacy:', err);
            setIsPrivate(!newPrivacy); // Revert on failure
        }
    };

    const handleResendVerification = async () => {
        setIsResending(true);
        try {
            await authApi.resendVerification(user.email);
            setAccountSuccess('Verification email sent!');
        } catch (err) {
            setAccountError('Failed to send verification email');
        } finally {
            setIsResending(false);
        }
    };

    const handleChangeEmail = async () => {
        if (!changeEmail) return;
        if (user.has_password && !changeEmailPassword) {
            setAccountError('Current password is required to change email');
            return;
        }
        setIsChangingEmail(true);
        setAccountError('');
        setAccountSuccess('');
        try {
            await authApi.changeEmail({
                new_email: changeEmail,
                password: user.has_password ? changeEmailPassword : null
            });
            setAccountSuccess('Confirmation email sent to new address!');
            setChangeEmail('');
            setChangeEmailPassword('');
        } catch (err) {
            setAccountError(err.response?.data?.error || 'Failed to change email');
        } finally {
            setIsChangingEmail(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (user.has_password && !deleteAccountPassword) {
            setAccountError('Current password is required to delete account');
            return;
        }
        setIsDeleting(true);
        try {
            await authApi.deleteAccount({
                password: user.has_password ? deleteAccountPassword : null
            });
            // Manually clear storage to prevent AuthContext from attempting to restore session
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            // Force hard reload to reset application state
            window.location.href = '/';
        } catch (err) {
            logger.error("Delete failed:", err);
            setAccountError(err.response?.data?.error || 'Failed to delete account');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSignOut = () => {
        logout();
    };

    // Notification preferences handlers
    const handleTogglePreference = async (key) => {
        const newPreferences = {
            ...preferences,
            [key]: !preferences[key],
        };

        setPreferences(newPreferences);
        setIsSavingPreferences(true);

        try {
            await notificationApi.updatePreferences(newPreferences);
            setPreferencesMessage('Preferences saved successfully');
            setTimeout(() => setPreferencesMessage(''), 3000);
        } catch (error) {
            logger.error('Failed to update preferences:', error);
            setPreferences(preferences); // Revert on error
            setPreferencesMessage('Failed to save preferences');
            setTimeout(() => setPreferencesMessage(''), 3000);
        } finally {
            setIsSavingPreferences(false);
        }
    };

    const emailNotificationOptions = [
        {
            key: 'email_new_episodes',
            label: 'New Episode Alerts',
            description: 'Get an email when a new episode airs for anime in your list.',
        },
    ];

    const pushNotificationOptions = [
        {
            key: 'push_new_episodes',
            label: 'New Episode Alerts',
            description: 'Send a browser notification when a new episode airs.',
        },
        {
            key: 'push_review_replies',
            label: 'Review Replies',
            description: 'Send a browser notification when someone replies to your reviews.',
        },
        {
            key: 'push_new_follower',
            label: 'New Followers',
            description: 'Send a browser notification when someone follows you.',
        },
    ];

    const renderNotificationPreference = ({ key, label, description }) => {
        const isEnabled = Boolean(preferences[key]);

        return (
            <div key={key} className="flex items-start justify-between gap-4 py-4">
                <div className="pr-2">
                    <p className="text-sm font-semibold leading-5 text-gray-100 sm:text-[15px]">{label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-400">{description}</p>
                </div>

                <button
                    type="button"
                    role="switch"
                    aria-checked={isEnabled}
                    aria-label={label}
                    onClick={() => handleTogglePreference(key)}
                    disabled={isSavingPreferences}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-100
                    ${isEnabled ? 'border-accent bg-accent' : 'border-gray-700 bg-dark-50'}
                    ${isSavingPreferences ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                    <span
                        className={`h-5 w-5 rounded-full bg-white transition-transform duration-200 ${isEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                </button>
            </div>
        );
    };

    return (
        <>
            <SEO page="settings" />
            <div className="min-h-screen py-20 px-4">
                <div className="max-w-4xl mx-auto">
                    {/* Header */}
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
                        <p className="text-gray-400">Manage your profile and account settings</p>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 sm:gap-4 mb-8 border-b border-gray-800 overflow-x-auto scrollbar-hide whitespace-nowrap touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0">
                        <button
                            onClick={() => setActiveTab('profile')}
                            className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                            ${activeTab === 'profile' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Profile
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                            ${activeTab === 'profile' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        {user?.total_badges_count > 0 && (
                            <button
                                onClick={() => setActiveTab('badges')}
                                className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                                ${activeTab === 'badges' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                            >
                                Badges
                                <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                                ${activeTab === 'badges' ? 'scale-x-100' : 'scale-x-0'}`} />
                            </button>
                        )}
                        <button
                            onClick={() => setActiveTab('account')}
                            className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                            ${activeTab === 'account' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Account
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                            ${activeTab === 'account' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('notifications')}
                            className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                            ${activeTab === 'notifications' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Notifications
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                            ${activeTab === 'notifications' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                    </div>

                    {/* Profile Tab */}
                    {activeTab === 'profile' && (
                        <div className="bg-dark-100 p-6 rounded-2xl animate-fade-in">
                            <h2 className="text-xl font-semibold text-white mb-6">Profile Settings</h2>

                            <div className="space-y-6">
                                {/* Username */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="input w-full max-w-md"
                                        placeholder="Enter your username"
                                    />
                                    <p className="text-xs text-gray-500 mt-2">You can change your username once every 14 days.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Timezone</label>
                                    <CustomSelect
                                        value={preferredTimezone}
                                        onChange={(value) => setPreferredTimezone(normalizeTimeZonePreference(value))}
                                        options={timezoneOptions}
                                        className="max-w-md"
                                        triggerClassName="w-full"
                                        menuClassName="max-h-72"
                                        placeholder="Select timezone"
                                        ariaLabel="Select preferred timezone"
                                    />
                                    <p className="text-xs text-gray-500 mt-2">
                                        {preferredTimezone === AUTO_TIMEZONE_VALUE
                                            ? `Auto-detected from this browser. Times currently display in ${browserTimezone}.`
                                            : `Times currently display in ${resolvedTimezone}.`}
                                    </p>
                                    <p className="text-xs text-gray-600 mt-1">
                                        Preview: {timezonePreview || 'Unavailable'}
                                    </p>
                                </div>

                                {/* Avatar */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Profile Picture</label>
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                                        <div className="w-24 h-24 sm:w-24 sm:h-24 rounded-2xl overflow-hidden flex items-center justify-center shrink-0">
                                            {avatarPreviewUrl ? (
                                                <img src={avatarPreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                                            ) : user?.avatar ? (
                                                <img src={user.avatar} alt="Current" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-accent flex items-center justify-center">
                                                    <span className="text-xl text-white font-bold">{user?.username?.charAt(0)}</span>
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files.length > 0) {
                                                    const file = e.target.files[0];
                                                    const url = URL.createObjectURL(file);
                                                    setCropModal({
                                                        isOpen: true,
                                                        imageSrc: url,
                                                        sourceMimeType: file.type || '',
                                                        type: 'avatar'
                                                    });
                                                }
                                                // Reset the input so selecting the same file triggers onChange
                                                e.target.value = null;
                                            }}
                                            className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 
                                                   file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                        />
                                    </div>
                                </div>

                                {/* Banner */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Banner Image</label>
                                    <div className="relative mb-3 w-full aspect-[3.2/1] overflow-hidden rounded-xl group sm:aspect-[3.8/1] md:aspect-[4.6/1] lg:aspect-[4.9/1] xl:aspect-[5.2/1] 2xl:aspect-[5.8/1]">
                                        {bannerPreviewUrl ? (
                                            <img src={bannerPreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                                        ) : user?.banner && !removeBanner ? (
                                            <img src={user.banner} alt="Current" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">No Banner</div>
                                        )}
                                        {(user?.banner || bannerPreviewUrl) && !removeBanner && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setRemoveBanner(true);
                                                    setBannerFile(null);
                                                    setBannerPreviewUrl(null);
                                                }}
                                                className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-red-500 text-white rounded-lg backdrop-blur-sm flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200 text-sm font-medium"
                                                title="Remove banner"
                                            >
                                                <span className="hidden sm:inline">Remove</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files.length > 0) {
                                                    const file = e.target.files[0];
                                                    const url = URL.createObjectURL(file);
                                                    setCropModal({
                                                        isOpen: true,
                                                        imageSrc: url,
                                                        sourceMimeType: file.type || '',
                                                        type: 'banner'
                                                    });
                                                    setRemoveBanner(false);
                                                }
                                                e.target.value = null;
                                            }}
                                            className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 
                                                   file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                        />
                                        {removeBanner && (
                                            <div className="flex items-center gap-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                                <span className="text-xs text-yellow-400">Banner will be removed on save</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setRemoveBanner(false)}
                                                    className="text-xs text-accent hover:text-accent/80"
                                                >
                                                    Undo
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Bio */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-gray-300">About (Bio)</label>
                                        <span className={`text-xs ${bio.length > 4900 ? 'text-red-400' :
                                            bio.length > 4000 ? 'text-yellow-400' :
                                                'text-gray-500'
                                            }`}>
                                            {bio.length}/5000
                                        </span>
                                    </div>

                                    <div className="rounded-2xl overflow-hidden">
                                        <RichTextEditor
                                            value={bio}
                                            onChange={(newBio) => {
                                                if (newBio.length <= 5000) {
                                                    setBio(newBio);
                                                }
                                            }}
                                            placeholder="Tell us about yourself..."
                                            editorMinRows={8}
                                            editorMaxRows={14}
                                        />
                                    </div>
                                    {bio.length > 4900 && (
                                        <p className="text-xs text-red-400 mt-1">
                                            {5000 - bio.length} characters remaining
                                        </p>
                                    )}
                                </div>

                                {/* Profile Primary Color */}
                                <div className="pt-4 border-t border-gray-800">
                                    <label className="block text-sm font-medium text-gray-300 mb-3">
                                        Profile Primary Color
                                    </label>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="color"
                                                value={normalizeProfilePrimaryColor(profilePrimaryColor)}
                                                onChange={(e) => setProfilePrimaryColor(normalizeProfilePrimaryColor(e.target.value))}
                                                className="h-11 w-14 cursor-pointer rounded-lg border border-transparent bg-dark-50 p-1"
                                                aria-label="Choose profile primary color"
                                            />
                                            <input
                                                type="text"
                                                value={normalizeProfilePrimaryColor(profilePrimaryColor)}
                                                readOnly
                                                className="input w-32 font-mono uppercase cursor-default"
                                                aria-label="Selected profile color hex value"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {PROFILE_COLOR_PRESETS.map((color) => {
                                                const isSelected = normalizeProfilePrimaryColor(profilePrimaryColor) === color;
                                                return (
                                                    <button
                                                        key={color}
                                                        type="button"
                                                        onClick={() => setProfilePrimaryColor(color)}
                                                        className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${isSelected ? 'border-white' : 'border-transparent'}`}
                                                        style={{ backgroundColor: color }}
                                                        title={color}
                                                        aria-label={`Set profile color ${color}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        This color is used as the accent across your profile page.
                                    </p>
                                </div>

                                {/* Social Links */}
                                <div className="pt-4 border-t border-gray-800">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-lg font-medium text-white">Social Links</h3>
                                            <span className={`text-sm font-medium ${socialLinks.length >= 5 ? 'text-red-400' : 'text-gray-400'
                                                }`}>
                                                {socialLinks.length}/5
                                            </span>
                                        </div>
                                        {socialLinks.length < 5 && (
                                            <button
                                                type="button"
                                                onClick={() => setSocialLinks([...socialLinks, { platform: '', value: '' }])}
                                                className="text-xs font-medium text-accent hover:text-accent/80 transition-colors flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 rounded-lg hover:bg-accent/20"
                                            >
                                                Add Link
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-4 max-w-2xl">
                                        {socialLinks.length === 0 ? (
                                            <div className="p-6 bg-dark-100 rounded-xl text-center">
                                                <p className="text-gray-500 mb-2">No social links added yet.</p>
                                                <p className="text-xs text-gray-600">Add up to 5 links to your profile</p>
                                            </div>
                                        ) : (
                                            <>
                                                {socialLinks.map((link, index) => {
                                                    // Check for duplicates
                                                    const currentKey = getSocialLinkDuplicateKey(link);
                                                    const isDuplicate = Boolean(currentKey) && socialLinks.some((l, i) =>
                                                        i !== index && getSocialLinkDuplicateKey(l) === currentKey
                                                    );

                                                    // Check for empty platform
                                                    const isEmptyPlatform = !link.platform?.trim();

                                                    return (
                                                        <div
                                                            key={index}
                                                            className={`relative rounded-xl p-4 transition-colors ${isDuplicate
                                                                ? 'bg-red-500/5'
                                                                : isEmptyPlatform
                                                                    ? 'bg-yellow-500/[0.05]'
                                                                    : 'bg-dark-100'
                                                                }`}
                                                        >
                                                            {/* Header with index and remove button */}
                                                            <div className="flex items-center justify-between mb-3">
                                                                <span className="text-xs font-medium text-gray-500">
                                                                    Link {index + 1}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (confirm('Remove this link?')) {
                                                                            setSocialLinks(socialLinks.filter((_, i) => i !== index));
                                                                        }
                                                                    }}
                                                                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                                                    title="Remove link"
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>

                                                            <SmartLinkInput
                                                                platform={link.platform}
                                                                value={link.value}
                                                                onChange={(newValue) => {
                                                                    const newLinks = [...socialLinks];
                                                                    newLinks[index].value = newValue;
                                                                    setSocialLinks(newLinks);
                                                                }}
                                                                onPlatformChange={(newPlatform) => {
                                                                    const newLinks = [...socialLinks];
                                                                    newLinks[index].platform = newPlatform;
                                                                    setSocialLinks(newLinks);
                                                                }}
                                                                disabled={isSavingProfile}
                                                            />

                                                            {/* Warnings */}
                                                            {isDuplicate && (
                                                                <div className="flex items-center gap-1.5 mt-2 text-red-400 text-xs">
                                                                    <AlertCircle className="w-3.5 h-3.5" />
                                                                    <span>Duplicate link detected</span>
                                                                </div>
                                                            )}
                                                            {isEmptyPlatform && (
                                                                <div className="flex items-center gap-1.5 mt-2 text-yellow-400 text-xs">
                                                                    <AlertCircle className="w-3.5 h-3.5" />
                                                                    <span>Platform name is required</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        )}

                                        {socialLinks.length >= 5 && (
                                            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                                <p className="text-xs text-yellow-400 text-center">
                                                    Maximum of 5 links reached. Remove a link to add a new one.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Error/Success */}
                                {profileError && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        {profileError}
                                    </div>
                                )}
                                {profileSuccess && (
                                    <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-400 text-sm">
                                        <Check className="w-4 h-4 shrink-0" />
                                        {profileSuccess}
                                    </div>
                                )}

                                <button
                                    onClick={handleSaveProfile}
                                    disabled={isSavingProfile}
                                    className="btn-primary"
                                >
                                    {isSavingProfile ? 'Saving...' : 'Save Profile'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Badges Tab */}
                    {activeTab === 'badges' && (
                        <div className="animate-fade-in">
                            <BadgesSettings />
                        </div>
                    )}

                    {/* Account Tab */}
                    {activeTab === 'account' && (
                        <div className="space-y-6 animate-fade-in">
                            {/* Email & Security */}
                            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                                <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-accent" />
                                    Email & Security
                                </h2>

                                {/* Email Verification Status */}
                                <div className="mb-8 p-4 bg-dark-50 rounded-xl border border-gray-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-300">Email Status</span>
                                        {user?.email_verified ? (
                                            <span className="flex items-center gap-1.5 text-green-400 text-sm font-medium bg-green-400/10 px-2 py-1 rounded-lg border border-green-400/20">
                                                <Check className="w-3.5 h-3.5" /> Verified
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-yellow-400 text-sm font-medium bg-yellow-400/10 px-2 py-1 rounded-lg border border-yellow-400/20">
                                                <AlertCircle className="w-3.5 h-3.5" /> Unverified
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-400 mb-3">{user?.email}</p>

                                    {!user?.email_verified && (
                                        <button
                                            onClick={handleResendVerification}
                                            disabled={isResending}
                                            className="text-accent hover:text-accent-hover text-sm font-medium disabled:opacity-50"
                                        >
                                            {isResending ? 'Sending...' : 'Resend Verification Email'}
                                        </button>
                                    )}
                                </div>

                                {/* Change Email */}
                                <div className="mb-8">
                                    <h3 className="text-lg font-medium text-white mb-4">Change Email</h3>
                                    <div className="space-y-4 max-w-md">
                                        <input
                                            type="email"
                                            value={changeEmail}
                                            onChange={(e) => setChangeEmail(e.target.value)}
                                            className="input w-full"
                                            placeholder="New Email Address"
                                            required
                                        />
                                        {user.has_password && (
                                            <input
                                                type="password"
                                                value={changeEmailPassword}
                                                onChange={(e) => setChangeEmailPassword(e.target.value)}
                                                className="input w-full"
                                                placeholder="Confirm with Password"
                                                required
                                            />
                                        )}
                                        <button
                                            onClick={handleChangeEmail}
                                            disabled={isChangingEmail || !changeEmail || (user.has_password && !changeEmailPassword)}
                                            className="btn-primary w-full sm:w-auto"
                                        >
                                            {isChangingEmail ? 'Sending Link...' : 'Update Email'}
                                        </button>
                                    </div>
                                    {(accountError || accountSuccess) && (
                                        <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${accountSuccess
                                            ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                            : 'bg-red-500/10 border border-red-500/20 text-red-400'
                                            }`}>
                                            {accountSuccess ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                            {accountSuccess || accountError}
                                        </div>
                                    )}
                                </div>

                                <div className="h-px bg-gray-700 my-6" />

                                <h3 className="text-lg font-medium text-white mb-4">
                                    {user.has_password ? 'Change Password' : 'Set Password'}
                                </h3>

                                <div className="space-y-4 max-w-md">
                                    {user.has_password && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">Current Password</label>
                                            <div className="relative">
                                                <input
                                                    type={showOldPassword ? 'text' : 'password'}
                                                    value={oldPassword}
                                                    onChange={(e) => setOldPassword(e.target.value)}
                                                    className="input w-full pr-10"
                                                    placeholder="Enter current password"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowOldPassword(!showOldPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                                >
                                                    {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* New Password */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">New Password</label>
                                        <div className="relative">
                                            <input
                                                type={showNewPassword ? 'text' : 'password'}
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                className="input w-full pr-10"
                                                placeholder="Enter new password"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowNewPassword(!showNewPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                            >
                                                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Confirm Password */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">Confirm New Password</label>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="input w-full"
                                            placeholder="Confirm new password"
                                        />
                                    </div>

                                    <button
                                        onClick={handleChangePassword}
                                        disabled={isSavingAccount || (user.has_password && !oldPassword) || !newPassword || !confirmPassword}
                                        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSavingAccount ? 'Saving...' : (user.has_password ? 'Change Password' : 'Set Password')}
                                    </button>
                                </div>
                            </div>

                            {/* Privacy Settings */}
                            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                                <h2 className="text-xl font-semibold text-white mb-6">
                                    Privacy
                                </h2>

                                <div className="flex items-center justify-between max-w-md">
                                    <div>
                                        <p className="text-white font-medium">Private Profile</p>
                                        <p className="text-gray-400 text-sm">Hide your profile from other users</p>
                                    </div>
                                    <button
                                        onClick={handlePrivacyToggle}
                                        className={`relative w-14 h-7 rounded-full transition-colors duration-200 
                                                ${isPrivate ? 'bg-accent' : 'bg-dark-50 border border-gray-700'}`}
                                    >
                                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200
                                                ${isPrivate ? 'left-8' : 'left-1'}`} />
                                    </button>
                                </div>

                            </div>

                            {/* Data Import/Export */}
                            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                                <h2 className="text-xl font-semibold text-white mb-6">
                                    Data Import/Export
                                </h2>

                                <div className="space-y-4 max-w-md">
                                    <Link
                                        to="/import"
                                        className="flex items-center justify-between p-4 bg-dark-50 hover:bg-dark-200 rounded-xl border border-gray-800 transition-colors group"
                                    >
                                        <div>
                                            <p className="text-white font-medium">Import Data</p>
                                            <p className="text-gray-400 text-sm">Import from MyAnimeList or AniList</p>
                                        </div>
                                    </Link>

                                    <Link
                                        to="/export"
                                        className="flex items-center justify-between p-4 bg-dark-50 hover:bg-dark-200 rounded-xl border border-gray-800 transition-colors group"
                                    >
                                        <div>
                                            <p className="text-white font-medium">Export Data</p>
                                            <p className="text-gray-400 text-sm">Download your anime list and reviews</p>
                                        </div>
                                    </Link>
                                </div>
                            </div>

                            {/* Sign Out */}
                            <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                                <h2 className="text-xl font-semibold text-white mb-2">Session</h2>
                                <p className="text-gray-400 text-sm mb-6">
                                    Sign out from this device.
                                </p>
                                <button
                                    onClick={handleSignOut}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors font-medium text-sm"
                                >
                                    Sign Out
                                </button>
                            </div>

                            {/* Delete Account */}
                            <div className="bg-red-500/5 p-6 rounded-2xl border border-red-500/20">
                                <h2 className="text-xl font-semibold text-red-500 mb-2">Delete Account</h2>
                                <p className="text-gray-400 text-sm mb-6">
                                    Once you delete your account, there is no going back. Please be certain.
                                </p>

                                {!showDeleteConfirm ? (
                                    <button
                                        onClick={() => setShowDeleteConfirm(true)}
                                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 rounded-lg transition-colors font-medium text-sm"
                                    >
                                        Delete Account
                                    </button>
                                ) : (
                                    <div className="max-w-md animate-fade-in">
                                        {user.has_password ? (
                                            <>
                                                <p className="text-sm text-gray-300 mb-3 block">Enter your password to confirm:</p>
                                                <div className="flex gap-3">
                                                    <input
                                                        type="password"
                                                        value={deleteAccountPassword}
                                                        onChange={(e) => setDeleteAccountPassword(e.target.value)}
                                                        className="input flex-1 border-red-500/30 focus:border-red-500 focus:ring-red-500/20"
                                                        placeholder="Your Password"
                                                    />
                                                    <button
                                                        onClick={handleDeleteAccount}
                                                        disabled={isDeleting || !deleteAccountPassword}
                                                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setShowDeleteConfirm(false);
                                                            setDeleteAccountPassword('');
                                                        }}
                                                        className="px-4 py-2 bg-dark-50 hover:bg-dark-200 text-gray-300 border border-gray-700 rounded-lg transition-colors font-medium text-sm"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-col gap-3">
                                                <p className="text-sm text-gray-300 mb-2">Are you sure you want to delete your account? This action cannot be undone.</p>
                                                <div className="flex gap-3">
                                                    <button
                                                        onClick={handleDeleteAccount}
                                                        disabled={isDeleting}
                                                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
                                                    >
                                                        {isDeleting ? 'Deleting...' : 'Yes, Delete My Account'}
                                                    </button>
                                                    <button
                                                        onClick={() => setShowDeleteConfirm(false)}
                                                        className="px-4 py-2 bg-dark-50 hover:bg-dark-200 text-gray-300 border border-gray-700 rounded-lg transition-colors font-medium text-sm"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Notifications Tab */}
                    {activeTab === 'notifications' && (
                        <div className="space-y-6 animate-fade-in">
                            {/* Success/Error Message */}
                            {preferencesMessage && (
                                <div className={`p-4 rounded-xl flex items-center gap-3 ${preferencesMessage.includes('success')
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                                    }`}>
                                    {preferencesMessage.includes('success') ? (
                                        <div className="w-5 h-5 border-2 border-green-500 rounded-full flex items-center justify-center text-[10px] font-bold">✓</div>
                                    ) : (
                                        <div className="w-5 h-5 border-2 border-red-500 rounded-full flex items-center justify-center text-[10px] font-bold">!</div>
                                    )}
                                    <span className="font-medium">{preferencesMessage}</span>
                                </div>
                            )}

                            {/* Email Notifications */}
                            <div className="rounded-2xl border border-gray-800 bg-dark-100 p-5 sm:p-6">
                                <div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-100 sm:text-xl">Email Notifications</h2>
                                        <p className="mt-1 text-sm text-gray-400">Get notified via email</p>
                                    </div>
                                </div>

                                {isLoadingPreferences ? (
                                    <div className="flex items-center justify-center py-8">
                                        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : (
                                    <div className="mt-5 divide-y divide-gray-800/80">
                                        {emailNotificationOptions.map(renderNotificationPreference)}
                                    </div>
                                )}
                            </div>

                            {/* Push Notifications */}
                            <div className="rounded-2xl border border-gray-800 bg-dark-100 p-5 sm:p-6">
                                <div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-100 sm:text-xl">Push Notifications</h2>
                                        <p className="mt-1 text-sm text-gray-400">Get notified in your browser</p>
                                    </div>
                                </div>

                                {isLoadingPreferences ? (
                                    <div className="flex items-center justify-center py-8">
                                        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : (
                                    <div className="mt-5 divide-y divide-gray-800/80">
                                        {pushNotificationOptions.map(renderNotificationPreference)}
                                    </div>
                                )}
                            </div>

                            {/* Info Section */}
                            <div className="rounded-2xl border border-gray-800/80 bg-dark-100/70 p-5">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-100">About Notifications</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-gray-400">
                                        Notifications help you stay up to date with your anime. You&apos;ll receive alerts for new episodes
                                        in your Watching or Plan to Watch lists, plus replies to your reviews.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ImageCropModal
                isOpen={cropModal.isOpen}
                imageSrc={cropModal.imageSrc}
                aspect={cropModal.type === 'banner' ? bannerCropAspect : 1}
                mediaType={cropModal.type}
                sourceMimeType={cropModal.sourceMimeType}
                cropShape={cropModal.type === 'banner' ? 'rect' : 'rect'}
                title={cropModal.type === 'banner' ? 'Edit banner' : 'Edit profile picture'}
                onClose={() => {
                    setCropModal({ ...cropModal, isOpen: false });
                    if (cropModal.imageSrc) {
                        URL.revokeObjectURL(cropModal.imageSrc);
                    }
                }}
                onApply={(file, previewUrl) => {
                    if (cropModal.type === 'banner') {
                        setBannerFile(file);
                        setBannerPreviewUrl(previewUrl);
                    } else {
                        setAvatarFile(file);
                        setAvatarPreviewUrl(previewUrl);
                    }
                    setCropModal({ ...cropModal, isOpen: false });
                    if (cropModal.imageSrc) {
                        URL.revokeObjectURL(cropModal.imageSrc);
                    }
                }}
            />
        </>
    );
}
