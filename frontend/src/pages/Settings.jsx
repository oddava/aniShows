import { useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import SEO from '../components/SEO';
import ImageCropModal from '../components/ImageCropModal';
import SettingsTabs, {
    settingsPanelId,
    settingsTabId,
    visibleSettingsTabs,
} from '../components/settings/SettingsTabs';
import ProfileTab from '../components/settings/ProfileTab';
import BadgesTab from '../components/settings/BadgesTab';
import AccountTab from '../components/settings/AccountTab';
import NotificationsTab from '../components/settings/NotificationsTab';
import useProfileSettings from '../components/settings/useProfileSettings';
import useAccountSettings from '../components/settings/useAccountSettings';
import useNotificationPreferences from '../components/settings/useNotificationPreferences';

export default function Settings() {
    const { user, isAuthenticated, loading, refreshProfile, logout } = useAuth();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();

    // The open tab lives in ?tab= so it can be linked to. Unknown values, and
    // Badges for a user without badges, fall back to Profile.
    const requestedTab = searchParams.get('tab');
    const activeTab = visibleSettingsTabs(user).some((tab) => tab.key === requestedTab)
        ? requestedTab
        : 'profile';
    const setActiveTab = useCallback((tab) => {
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set('tab', tab);
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    // Each tab's state lives here, not in the tab, so it survives tab switches.
    const profile = useProfileSettings({ user, refreshProfile, queryClient });
    const account = useAccountSettings({ user, logout });
    const notifications = useNotificationPreferences({ user, queryClient });
    const {
        cropModal,
        setCropModal,
        bannerCropAspect,
        setAvatarFile,
        setAvatarPreviewUrl,
        setBannerFile,
        setBannerPreviewUrl,
    } = profile;

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
                    <SettingsTabs user={user} activeTab={activeTab} setActiveTab={setActiveTab} />

                    <div
                        role="tabpanel"
                        id={settingsPanelId(activeTab)}
                        aria-labelledby={settingsTabId(activeTab)}
                    >
                        {/* Profile Tab */}
                        {activeTab === 'profile' && <ProfileTab user={user} profile={profile} />}

                        {/* Badges Tab */}
                        {activeTab === 'badges' && <BadgesTab />}

                        {/* Account Tab */}
                        {activeTab === 'account' && (
                            <AccountTab
                                user={user}
                                account={account}
                                isPrivate={profile.isPrivate}
                                handlePrivacyToggle={profile.handlePrivacyToggle}
                            />
                        )}

                        {/* Notifications Tab */}
                        {activeTab === 'notifications' && <NotificationsTab notifications={notifications} />}
                    </div>
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
