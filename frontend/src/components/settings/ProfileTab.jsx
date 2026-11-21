import { useState } from 'react';
import RichTextEditor from '../forums/RichTextEditor';
import CustomSelect from '../common/CustomSelect';
import { AUTO_TIMEZONE_VALUE, normalizeTimeZonePreference } from '../../utils/dateUtils';
import { PROFILE_COLOR_PRESETS, isGifFile, normalizeProfilePrimaryColor } from './settingsUtils';
import SocialLinksEditor from './SocialLinksEditor';
import SettingsSwitch from './SettingsSwitch';
import { toneProfileAccentColor } from '../../utils/profileAccent';
import useAdultContentPreference from '../../hooks/useAdultContentPreference';
import logger from '../../utils/logger';

// A field's label and its quiet help line.
const LABEL = 'block text-sm font-medium text-[var(--text-1)] mb-2';
const HELP = 'text-sm text-[var(--text-3)] mt-2';
// The native file picker, dressed as a quiet secondary button.
const FILE_INPUT = 'max-w-full text-sm text-[var(--text-2)] file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white/[0.06] file:px-4 file:text-sm file:font-medium file:text-[var(--text-1)] file:transition-colors hover:file:bg-white/10';

/** The "Content" panel: account-wide content preferences. */
function ContentCard() {
    const { enabled, toggle, isUpdating } = useAdultContentPreference();
    const [error, setError] = useState('');
    const labelId = 'settings-adult-content-label';
    const descriptionId = 'settings-adult-content-description';

    const handleToggle = async () => {
        setError('');
        try {
            await toggle();
        } catch (err) {
            logger.error('Failed to update adult content preference:', err);
            setError('Could not update this setting. Please try again.');
        }
    };

    return (
        <section className="panel mt-6">
            <h2 className="section-title mb-4">Content</h2>
            <div className="flex items-start justify-between gap-4">
                <div className="pr-2">
                    <p id={labelId} className="text-[15px] font-medium text-[var(--text-1)]">
                        Show adult content
                    </p>
                    <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
                        Include 18+ titles in browse, search and the schedule.
                    </p>
                </div>
                <SettingsSwitch
                    checked={enabled}
                    onClick={handleToggle}
                    disabled={isUpdating}
                    labelledBy={labelId}
                    describedBy={descriptionId}
                />
            </div>
            {error && (
                <p role="alert" className="text-sm text-[var(--danger)] mt-3">{error}</p>
            )}
        </section>
    );
}

/** The Profile tab. `profile` is the state from useProfileSettings. */
export default function ProfileTab({ user, profile }) {
    const {
        bio, setBio,
        username, setUsername,
        setAvatarFile,
        setBannerFile,
        removeBanner, setRemoveBanner,
        removeAvatar, setRemoveAvatar,
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

    const pickedColor = normalizeProfilePrimaryColor(profilePrimaryColor);
    const displayedColor = toneProfileAccentColor(pickedColor);
    const hasAvatar = Boolean(avatarPreviewUrl || user?.avatar);
    const hasBanner = Boolean(user?.banner || bannerPreviewUrl) && !removeBanner;

    return (
        <>
        <section className="panel animate-fade-in">
            <h2 className="section-title mb-6">Your profile</h2>

            <div className="space-y-8">
                <div>
                    <label htmlFor="settings-username" className={LABEL}>Username</label>
                    <input
                        id="settings-username"
                        type="text"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="input w-full max-w-md"
                        placeholder="Your username"
                    />
                    <p className={HELP}>You can change your username once every 14 days.</p>
                </div>

                <div>
                    <p className={LABEL}>Timezone</p>
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
                    <p className={HELP}>
                        {preferredTimezone === AUTO_TIMEZONE_VALUE
                            ? `Auto-detected from this browser. Times currently display in ${browserTimezone}.`
                            : `Times currently display in ${resolvedTimezone}.`}
                    </p>
                    <p className="text-sm text-[var(--text-3)] mt-1">
                        Preview: {timezonePreview || 'unavailable'}
                    </p>
                </div>

                <div>
                    <p className={LABEL}>Profile picture</p>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="w-24 h-24 rounded-[var(--radius-lg)] overflow-hidden flex items-center justify-center shrink-0">
                            {avatarPreviewUrl ? (
                                <img src={avatarPreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                            ) : user?.avatar && !removeAvatar ? (
                                <img src={user.avatar} alt="Current" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-[var(--ink-3)] flex items-center justify-center">
                                    <span className="text-3xl font-semibold text-[var(--text-1)]">
                                        {user?.username?.charAt(0)?.toUpperCase()}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                type="file"
                                accept="image/*"
                                aria-label="Choose a profile picture"
                                onChange={(e) => {
                                    if (e.target.files && e.target.files.length > 0) {
                                        const file = e.target.files[0];
                                        const url = URL.createObjectURL(file);
                                        setRemoveAvatar(false);

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
                                className={FILE_INPUT}
                            />
                            {hasAvatar && !removeAvatar && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Only a saved avatar needs removing on the server;
                                        // an unsaved pick is just discarded.
                                        setRemoveAvatar(Boolean(user?.avatar));
                                        setAvatarFile(null);
                                        setAvatarPreviewUrl((currentUrl) => {
                                            if (currentUrl) URL.revokeObjectURL(currentUrl);
                                            return null;
                                        });
                                    }}
                                    className="btn-ghost text-sm"
                                >
                                    Remove avatar
                                </button>
                            )}
                            {removeAvatar && (
                                <div className="flex items-center gap-3 text-sm text-[var(--text-2)]">
                                    <span>Avatar will be removed on save</span>
                                    <button
                                        type="button"
                                        onClick={() => setRemoveAvatar(false)}
                                        className="text-link"
                                    >
                                        Undo
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <p className={HELP}>
                        Saved as WebP without photo metadata. Animated GIFs stay animated up to 512×512.
                    </p>
                </div>

                <div>
                    <p className={LABEL}>Banner image</p>
                    <div className="relative mb-3 w-full aspect-[3.2/1] overflow-hidden rounded-[var(--radius-md)] bg-white/[0.04] sm:aspect-[3.8/1] md:aspect-[4.6/1] lg:aspect-[4.9/1] xl:aspect-[5.2/1] 2xl:aspect-[5.8/1]">
                        {bannerPreviewUrl ? (
                            <img src={bannerPreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : user?.banner && !removeBanner ? (
                            <img src={user.banner} alt="Current" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--text-3)] text-sm">
                                No banner yet
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="file"
                            accept="image/*"
                            aria-label="Choose a banner image"
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
                            className={FILE_INPUT}
                        />
                        {hasBanner && (
                            <button
                                type="button"
                                onClick={() => {
                                    setRemoveBanner(true);
                                    setBannerFile(null);
                                    setBannerPreviewUrl(null);
                                }}
                                className="btn-ghost text-sm"
                            >
                                Remove banner
                            </button>
                        )}
                        {removeBanner && (
                            <div className="flex items-center gap-3 text-sm text-[var(--text-2)]">
                                <span>Banner will be removed on save</span>
                                <button
                                    type="button"
                                    onClick={() => setRemoveBanner(false)}
                                    className="text-link"
                                >
                                    Undo
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-[var(--text-1)]">Bio</p>
                        <span className={`text-sm tabular ${bio.length > 4900 ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}>
                            {bio.length}/5000
                        </span>
                    </div>

                    {/* The editor's toolbar buttons are small; on touch screens
                        every one of them gets a 44 px target. */}
                    <div className="rounded-[var(--radius-md)] overflow-hidden max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
                        <RichTextEditor
                            value={bio}
                            onChange={(newBio) => {
                                if (newBio.length <= 5000) {
                                    setBio(newBio);
                                }
                            }}
                            placeholder="A few words about you"
                            editorMinRows={12}
                            editorMaxRows={24}
                            stackDesktopPreview
                            showPreviewWhenDirty
                            isDirty={isBioEdited}
                            editorTextClassName="text-sm leading-[1.72] text-[var(--text-2)] placeholder:text-[var(--text-3)]"
                            previewClassName="overview-about-markdown"
                        />
                    </div>
                    {bio.length > 4900 && (
                        <p className="text-sm text-[var(--danger)] mt-2">
                            {5000 - bio.length} characters remaining
                        </p>
                    )}
                </div>

                <div>
                    <p className={LABEL}>Profile color</p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={pickedColor}
                                onChange={(e) => setProfilePrimaryColor(normalizeProfilePrimaryColor(e.target.value))}
                                className="h-11 w-14 cursor-pointer rounded-lg border-0 bg-white/[0.06] p-1"
                                aria-label="Choose profile primary color"
                            />
                            <input
                                type="text"
                                value={pickedColor}
                                readOnly
                                className="input w-32 font-mono cursor-default"
                                aria-label="Selected profile color hex value"
                            />
                            <span
                                className="h-11 w-11 shrink-0 rounded-lg"
                                style={{ backgroundColor: displayedColor }}
                                title={`Shown as ${displayedColor}`}
                                data-testid="profile-color-preview"
                                aria-hidden="true"
                            />
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                            {PROFILE_COLOR_PRESETS.map((color) => {
                                const isSelected = pickedColor === color;
                                return (
                                    <button
                                        key={color}
                                        type="button"
                                        onClick={() => setProfilePrimaryColor(color)}
                                        aria-pressed={isSelected}
                                        className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors duration-150 ${isSelected ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'}`}
                                        title={color}
                                        aria-label={`Set profile color ${color}`}
                                    >
                                        <span aria-hidden="true" className="h-7 w-7 rounded-full" style={{ backgroundColor: color }} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <p className={HELP}>Used as the accent on your profile page.</p>
                    {displayedColor !== pickedColor && (
                        <p className="text-sm text-[var(--text-3)] mt-1">
                            Adjusted for readability
                            <span className="sr-only">: shown as {displayedColor}</span>
                        </p>
                    )}
                </div>

                <SocialLinksEditor
                    socialLinks={socialLinks}
                    setSocialLinks={setSocialLinks}
                    isSavingProfile={isSavingProfile}
                />

                <div className="space-y-3">
                    {profileError && (
                        <p role="alert" className="text-sm text-[var(--danger)]">{profileError}</p>
                    )}
                    {profileSuccess && (
                        <p role="status" className="text-sm text-[var(--text-2)]">{profileSuccess}</p>
                    )}
                    <button
                        type="button"
                        onClick={handleSaveProfile}
                        disabled={isSavingProfile}
                        className="btn-primary"
                    >
                        {isSavingProfile ? 'Saving...' : 'Save profile'}
                    </button>
                </div>
            </div>
        </section>

        <ContentCard />
        </>
    );
}
