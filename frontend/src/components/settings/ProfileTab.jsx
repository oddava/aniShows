import { AlertCircle, Check } from 'lucide-react';
import RichTextEditor from '../forums/RichTextEditor';
import CustomSelect from '../common/CustomSelect';
import { AUTO_TIMEZONE_VALUE, normalizeTimeZonePreference } from '../../utils/dateUtils';
import { PROFILE_COLOR_PRESETS, isGifFile, normalizeProfilePrimaryColor } from './settingsUtils';
import SocialLinksEditor from './SocialLinksEditor';

/** The Profile tab. `profile` is the state from useProfileSettings. */
export default function ProfileTab({ user, profile }) {
    const {
        bio, setBio,
        username, setUsername,
        setAvatarFile,
        setBannerFile,
        removeBanner, setRemoveBanner,
        socialLinks, setSocialLinks,
        profilePrimaryColor, setProfilePrimaryColor,
        preferredTimezone, setPreferredTimezone,
        isSavingProfile,
        profileError,
        profileSuccess,
        setCropModal,
        avatarPreviewUrl, setAvatarPreviewUrl,
        bannerPreviewUrl, setBannerPreviewUrl,
        browserTimezone,
        timezoneOptions,
        resolvedTimezone,
        timezonePreview,
        isBioEdited,
        handleSaveProfile,
    } = profile;

    return (
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

                                    // Keep GIF avatars animated by uploading the original file directly.
                                    if (isGifFile(file)) {
                                        setAvatarFile(file);
                                        setAvatarPreviewUrl((currentUrl) => {
                                            if (currentUrl) URL.revokeObjectURL(currentUrl);
                                            return url;
                                        });
                                    } else {
                                        setCropModal({
                                            isOpen: true,
                                            imageSrc: url,
                                            sourceMimeType: file.type || '',
                                            type: 'avatar'
                                        });
                                    }
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
                            editorMinRows={12}
                            editorMaxRows={24}
                            stackDesktopPreview
                            showPreviewWhenDirty
                            isDirty={isBioEdited}
                            editorTextClassName="text-[13px] leading-[1.72] text-[#9ca7b8] placeholder:text-gray-500"
                            previewClassName="overview-about-markdown"
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
                <SocialLinksEditor
                    socialLinks={socialLinks}
                    setSocialLinks={setSocialLinks}
                    isSavingProfile={isSavingProfile}
                />

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
    );
}
