import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { User, Lock, Shield, Eye, EyeOff, AlertCircle, Check, Plus, Trash2, Mail, Bell, Tv, MessageCircle, Users, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authApi, notificationApi } from '../api/client';
import { Link } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import SEO from '../components/SEO';
import logger from '../utils/logger';
import SmartLinkInput from '../components/SmartLinkInput';

export default function Settings() {
    const { user, isAuthenticated, loading, refreshProfile } = useAuth();
    const [activeTab, setActiveTab] = useState('profile');

    // Profile settings state
    const [bio, setBio] = useState('');
    const [username, setUsername] = useState('');
    const [avatarFile, setAvatarFile] = useState(null);
    const [bannerFile, setBannerFile] = useState(null);
    const [removeBanner, setRemoveBanner] = useState(false);
    const [socialLinks, setSocialLinks] = useState([]);
    const [isPrivate, setIsPrivate] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');

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

    // Initialize state from user data
    useEffect(() => {
        if (user) {
            setBio(user.bio || '');
            setUsername(user.username || '');
            // Convert backend 'url' field to frontend 'value' field for compatibility
            const normalizedLinks = (user.social_links || []).map(link => ({
                platform: link.platform || '',
                value: link.value || link.url || ''  // Support both 'value' and 'url' fields
            }));
            setSocialLinks(normalizedLinks);
            setIsPrivate(user.is_private || false);
        }
    }, [user]);

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
        const linkValues = nonEmptyLinks.map(link => link.value?.toLowerCase()?.trim()).filter(Boolean);
        const uniqueValues = new Set(linkValues);
        if (linkValues.length !== uniqueValues.size) {
            setProfileError('Duplicate links detected. Please remove duplicates before saving.');
            setIsSavingProfile(false);
            return;
        }
        
        // Check if anything actually changed
        const hasChanges = (
            bio !== user.bio ||
            username.trim() !== user.username ||
            JSON.stringify(nonEmptyLinks) !== JSON.stringify(user.social_links || []) ||
            isPrivate !== user.is_private ||
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
            if (bio !== user.bio) formData.append('bio', bio);
            if (username.trim() !== user.username) formData.append('username', username.trim());
            
            // Only send social links if they changed
            const currentLinks = user.social_links || [];
            const linksChanged = JSON.stringify(nonEmptyLinks) !== JSON.stringify(currentLinks);
            if (linksChanged) {
                formData.append('social_links', JSON.stringify(nonEmptyLinks));
            }
            
            if (isPrivate !== user.is_private) formData.append('is_private', isPrivate);
            if (avatarFile) formData.append('avatar', avatarFile);
            if (bannerFile) formData.append('banner', bannerFile);
            if (removeBanner) formData.append('remove_banner', 'true');

            await authApi.updateProfile(formData);
            setProfileSuccess('Profile updated successfully!');
            
            // Clear file inputs immediately for better UX
            setAvatarFile(null);
            setBannerFile(null);
            setRemoveBanner(false);
            
            // Refresh profile data in background (don't block UI)
            refreshProfile();
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
        } catch (err) {
            logger.error('Failed to update privacy:', err);
            setIsPrivate(!newPrivacy); // Revert on failure
        }
    };

    const handleResendVerification = async () => {
        setIsResending(true);
        try {
            await authApi.resendVerification({ email: user.email });
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
                <div className="flex gap-4 mb-8 border-b border-gray-800">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className={`flex items-center gap-2 pb-4 px-2 font-medium transition-all duration-200 relative
                            ${activeTab === 'profile' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                    >
                        <User className="w-4 h-4" />
                        Profile
                        <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left 
                            ${activeTab === 'profile' ? 'scale-x-100' : 'scale-x-0'}`} />
                    </button>
                    <button
                        onClick={() => setActiveTab('account')}
                        className={`flex items-center gap-2 pb-4 px-2 font-medium transition-all duration-200 relative
                            ${activeTab === 'account' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                    >
                        <Shield className="w-4 h-4" />
                        Account
                        <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left 
                            ${activeTab === 'account' ? 'scale-x-100' : 'scale-x-0'}`} />
                    </button>
                    <button
                        onClick={() => setActiveTab('notifications')}
                        className={`flex items-center gap-2 pb-4 px-2 font-medium transition-all duration-200 relative
                            ${activeTab === 'notifications' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                    >
                        <Bell className="w-4 h-4" />
                        Notifications
                        <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left 
                            ${activeTab === 'notifications' ? 'scale-x-100' : 'scale-x-0'}`} />
                    </button>
                </div>

                {/* Profile Tab */}
                {activeTab === 'profile' && (
                    <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800 animate-fade-in">
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

                            {/* Avatar */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Profile Picture</label>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                                    <div className="w-24 h-24 sm:w-20 sm:h-20 rounded-full bg-dark-50 border border-gray-700 overflow-hidden flex items-center justify-center shrink-0">
                                        {avatarFile ? (
                                            <img src={URL.createObjectURL(avatarFile)} alt="Preview" className="w-full h-full object-cover" />
                                        ) : user?.avatar ? (
                                            <img src={user.avatar} alt="Current" className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="w-10 h-10 text-gray-500" />
                                        )}
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => setAvatarFile(e.target.files[0])}
                                        className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 
                                                   file:text-sm file:font-semibold file:bg-dark-50 file:text-accent hover:file:bg-dark-200"
                                    />
                                </div>
                            </div>

                            {/* Banner */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Banner Image</label>
                                <div className="relative aspect-[3/1] sm:aspect-[4/1] max-w-2xl rounded-xl bg-dark-50 border border-gray-700 overflow-hidden mb-3 group">
                                    {bannerFile ? (
                                        <img src={URL.createObjectURL(bannerFile)} alt="Preview" className="w-full h-full object-cover" />
                                    ) : user?.banner && !removeBanner ? (
                                        <img src={user.banner} alt="Current" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">No Banner</div>
                                    )}
                                    {(user?.banner || bannerFile) && !removeBanner && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRemoveBanner(true);
                                                setBannerFile(null);
                                            }}
                                            className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-red-500 text-white rounded-lg backdrop-blur-sm flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200 text-sm font-medium"
                                            title="Remove banner"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            <span className="hidden sm:inline">Remove</span>
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                            setBannerFile(e.target.files[0]);
                                            setRemoveBanner(false);
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
                                    <label className="block text-sm font-medium text-gray-300">Bio</label>
                                    <span className={`text-xs ${
                                        bio.length > 160 ? 'text-red-400' : 
                                        bio.length > 140 ? 'text-yellow-400' : 
                                        'text-gray-500'
                                    }`}>
                                        {bio.length}/180
                                    </span>
                                </div>
                                
                                <textarea
                                    value={bio}
                                    onChange={(e) => {
                                        if (e.target.value.length <= 180) {
                                            setBio(e.target.value);
                                        }
                                    }}
                                    maxLength={180}
                                    spellCheck="false"
                                    placeholder="Tell us about yourself..."
                                    className={`input min-h-[80px] resize-none w-full max-w-xl ${
                                        bio.length > 160 ? 'border-red-500/50 focus:border-red-500' : ''
                                    }`}
                                />
                                {bio.length > 160 && (
                                    <p className="text-xs text-red-400 mt-1">
                                        {180 - bio.length} characters remaining
                                    </p>
                                )}
                            </div>

                            {/* Social Links */}
                            <div className="pt-4 border-t border-gray-800">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-lg font-medium text-white">Social Links</h3>
                                        <span className={`text-sm font-medium ${
                                            socialLinks.length >= 5 ? 'text-red-400' : 'text-gray-400'
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
                                            <Plus className="w-3.5 h-3.5" />
                                            Add Link
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-4 max-w-2xl">
                                    {socialLinks.length === 0 ? (
                                        <div className="p-6 bg-dark-200/30 rounded-xl border border-white/5 text-center">
                                            <p className="text-gray-500 mb-2">No social links added yet.</p>
                                            <p className="text-xs text-gray-600">Add up to 5 links to your profile</p>
                                        </div>
                                    ) : (
                                        <>
                                            {socialLinks.map((link, index) => {
                                                // Check for duplicates
                                                const isDuplicate = socialLinks.some((l, i) => 
                                                    i !== index && 
                                                    l.value && 
                                                    link.value && 
                                                    l.value.toLowerCase() === link.value.toLowerCase()
                                                );
                                                
                                                // Check for empty platform
                                                const isEmptyPlatform = !link.platform?.trim();
                                                
                                                return (
                                                    <div 
                                                        key={index} 
                                                        className={`relative bg-dark-200/50 p-4 rounded-xl border transition-all ${
                                                            isDuplicate 
                                                                ? 'border-red-500/30 bg-red-500/5' 
                                                                : isEmptyPlatform
                                                                    ? 'border-yellow-500/30'
                                                                    : 'border-white/10'
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
                                                                <Trash2 className="w-3.5 h-3.5" />
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
                                            
                                            {/* Help text */}
                                            <div className="p-4 bg-dark-200/30 rounded-xl border border-white/5">
                                                <h4 className="text-xs font-medium text-gray-400 mb-2">Tips:</h4>
                                                <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
                                                    <li>Enter @username for social platforms or paste a full URL</li>
                                                    <li>Links are automatically normalized (e.g., @user → https://x.com/user)</li>
                                                    <li>You can add up to 5 links to your profile</li>
                                                </ul>
                                            </div>
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
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                                <Shield className="w-5 h-5 text-accent" />
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
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
                                <Download className="w-5 h-5 text-accent" />
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
                                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-accent transition-colors" />
                                </Link>

                                <Link
                                    to="/export"
                                    className="flex items-center justify-between p-4 bg-dark-50 hover:bg-dark-200 rounded-xl border border-gray-800 transition-colors group"
                                >
                                    <div>
                                        <p className="text-white font-medium">Export Data</p>
                                        <p className="text-gray-400 text-sm">Download your anime list and reviews</p>
                                    </div>
                                    <Download className="w-5 h-5 text-gray-400 group-hover:text-accent transition-colors" />
                                </Link>
                            </div>
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
                            <div className={`p-4 rounded-xl flex items-center gap-3 ${
                                preferencesMessage.includes('success') 
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400' 
                                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                            }`}>
                                {preferencesMessage.includes('success') ? (
                                    <Check className="w-5 h-5" />
                                ) : (
                                    <AlertCircle className="w-5 h-5" />
                                )}
                                <span className="font-medium">{preferencesMessage}</span>
                            </div>
                        )}

                        {/* Email Notifications */}
                        <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                                    <Mail className="w-5 h-5 text-blue-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-white">Email Notifications</h2>
                                    <p className="text-sm text-gray-500">Get notified via email</p>
                                </div>
                            </div>
                            
                            {isLoadingPreferences ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* New Episode Alerts */}
                                    <div className="flex items-center justify-between py-4 border-b border-gray-700/50">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${preferences.email_new_episodes ? 'bg-accent/20' : 'bg-gray-700/50'}`}>
                                                <Tv className={`w-5 h-5 ${preferences.email_new_episodes ? 'text-accent' : 'text-gray-400'}`} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">New Episode Alerts</p>
                                                <p className="text-xs text-gray-500">Notify me when a new episode airs for anime in my list</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleTogglePreference('email_new_episodes')}
                                            disabled={isSavingPreferences}
                                            className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                                                preferences.email_new_episodes ? 'bg-accent' : 'bg-dark-50 border border-gray-700'
                                            } ${isSavingPreferences ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200
                                                ${preferences.email_new_episodes ? 'left-8' : 'left-1'}`} />
                                        </button>
                                    </div>

                                </div>
                            )}
                        </div>

                        {/* Push Notifications */}
                        <div className="bg-dark-100 p-6 rounded-2xl border border-gray-800">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                                    <Bell className="w-5 h-5 text-purple-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-white">Push Notifications</h2>
                                    <p className="text-sm text-gray-500">Get notified in your browser</p>
                                </div>
                            </div>
                            
                            {isLoadingPreferences ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* New Episode Alerts */}
                                    <div className="flex items-center justify-between py-4 border-b border-gray-700/50">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${preferences.push_new_episodes ? 'bg-accent/20' : 'bg-gray-700/50'}`}>
                                                <Tv className={`w-5 h-5 ${preferences.push_new_episodes ? 'text-accent' : 'text-gray-400'}`} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">New Episode Alerts</p>
                                                <p className="text-xs text-gray-500">Send push notification when a new episode airs</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleTogglePreference('push_new_episodes')}
                                            disabled={isSavingPreferences}
                                            className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                                                preferences.push_new_episodes ? 'bg-accent' : 'bg-dark-50 border border-gray-700'
                                            } ${isSavingPreferences ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200
                                                ${preferences.push_new_episodes ? 'left-8' : 'left-1'}`} />
                                        </button>
                                    </div>

                                    {/* Review Replies */}
                                    <div className="flex items-center justify-between py-4 border-b border-gray-700/50">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${preferences.push_review_replies ? 'bg-accent/20' : 'bg-gray-700/50'}`}>
                                                <MessageCircle className={`w-5 h-5 ${preferences.push_review_replies ? 'text-accent' : 'text-gray-400'}`} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">Review Replies</p>
                                                <p className="text-xs text-gray-500">Send push notification when someone replies to my reviews</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleTogglePreference('push_review_replies')}
                                            disabled={isSavingPreferences}
                                            className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                                                preferences.push_review_replies ? 'bg-accent' : 'bg-dark-50 border border-gray-700'
                                            } ${isSavingPreferences ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200
                                                ${preferences.push_review_replies ? 'left-8' : 'left-1'}`} />
                                        </button>
                                    </div>

                                    {/* New Followers */}
                                    <div className="flex items-center justify-between py-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${preferences.push_new_follower ? 'bg-accent/20' : 'bg-gray-700/50'}`}>
                                                <Users className={`w-5 h-5 ${preferences.push_new_follower ? 'text-accent' : 'text-gray-400'}`} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">New Followers</p>
                                                <p className="text-xs text-gray-500">Send push notification when someone follows me</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleTogglePreference('push_new_follower')}
                                            disabled={isSavingPreferences}
                                            className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                                                preferences.push_new_follower ? 'bg-accent' : 'bg-dark-50 border border-gray-700'
                                            } ${isSavingPreferences ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200
                                                ${preferences.push_new_follower ? 'left-8' : 'left-1'}`} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Info Section */}
                        <div className="bg-dark-100/50 p-4 rounded-xl border border-gray-700/30">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 bg-gray-700/50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <Bell className="w-4 h-4 text-gray-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-medium text-white mb-1">About Notifications</h3>
                                    <p className="text-sm text-gray-500">
                                        Notifications help you stay up to date with your anime. You'll receive alerts for new episodes 
                                        of anime in your Watching or Plan to Watch lists, as well as replies to your reviews.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </>
    );
}
