import { useCallback } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import SEO from "../components/SEO";
import useSwitchFade from "../hooks/useSwitchFade";
import ImageCropModal from "../components/ImageCropModal";
import SettingsTabs, {
  settingsPanelId,
  settingsTabId,
  visibleSettingsTabs,
} from "../components/settings/SettingsTabs";
import ProfileTab from "../components/settings/ProfileTab";
import BadgesTab from "../components/settings/BadgesTab";
import AccountTab from "../components/settings/AccountTab";
import NotificationsTab from "../components/settings/NotificationsTab";
import useProfileSettings from "../components/settings/useProfileSettings";
import useAccountSettings from "../components/settings/useAccountSettings";
import useNotificationPreferences from "../components/settings/useNotificationPreferences";

export default function Settings() {
  const { user, isAuthenticated, loading, refreshProfile, logout } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // The open tab lives in ?tab= so it can be linked to. Unknown values, and
  // Badges for a user without badges, fall back to Profile.
  const requestedTab = searchParams.get("tab");
  const activeTab = visibleSettingsTabs(user).some(
    (tab) => tab.key === requestedTab,
  )
    ? requestedTab
    : "profile";
  const setActiveTab = useCallback(
    (tab) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("tab", tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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
  const tabFade = useSwitchFade(activeTab);

  if (loading) {
    // A full viewport, like PageLoader, so the footer does not jump when the
    // page lands; the spinner only shows if the wait passes 300 ms.
    return (
      <div role="status" className="min-h-[100dvh] flex items-center justify-center">
        <div aria-hidden="true" className="delayed-show">
          <div className="w-10 h-10 border-2 border-[var(--signature)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
        </div>
        <span className="sr-only">Loading settings</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <SEO page="settings" />
      <div className="page-container pt-6 pb-16 md:pt-10">
        <div className="mx-auto max-w-3xl">
          <header>
            <h1 className="page-title">Settings</h1>
            <p className="mt-1 text-sm text-[var(--text-2)]">
              Your profile, account and notifications.
            </p>
          </header>

          <SettingsTabs
            user={user}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />

          <div
            key={activeTab}
            role="tabpanel"
            id={settingsPanelId(activeTab)}
            aria-labelledby={settingsTabId(activeTab)}
            className={`mt-6 ${tabFade}`}
          >
            {activeTab === "profile" && (
              <ProfileTab user={user} profile={profile} />
            )}

            {activeTab === "badges" && <BadgesTab />}

            {activeTab === "account" && (
              <AccountTab
                user={user}
                account={account}
                isPrivate={profile.isPrivate}
                handlePrivacyToggle={profile.handlePrivacyToggle}
              />
            )}

            {activeTab === "notifications" && (
              <NotificationsTab notifications={notifications} />
            )}
          </div>
        </div>
      </div>

      <ImageCropModal
        isOpen={cropModal.isOpen}
        imageSrc={cropModal.imageSrc}
        aspect={cropModal.type === "banner" ? bannerCropAspect : 1}
        mediaType={cropModal.type}
        sourceMimeType={cropModal.sourceMimeType}
        cropShape={cropModal.type === "banner" ? "rect" : "rect"}
        title={
          cropModal.type === "banner" ? "Edit banner" : "Edit profile picture"
        }
        onClose={() => {
          setCropModal({ ...cropModal, isOpen: false });
          if (cropModal.imageSrc) {
            URL.revokeObjectURL(cropModal.imageSrc);
          }
        }}
        onApply={(file, previewUrl) => {
          if (cropModal.type === "banner") {
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
