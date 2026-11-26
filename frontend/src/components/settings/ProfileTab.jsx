import { useState } from 'react';
import { Pipette } from 'lucide-react';
import RichTextEditor from '../forums/RichTextEditor';
import CustomSelect from '../common/CustomSelect';
import { AUTO_TIMEZONE_VALUE, normalizeTimeZonePreference } from '../../utils/dateUtils';
import { PROFILE_COLOR_PRESETS, isGifFile, normalizeProfilePrimaryColor } from './settingsUtils';
import SocialLinksEditor from './SocialLinksEditor';
import SettingsSwitch from './SettingsSwitch';
import { toneProfileAccentColor } from '../../utils/profileAccent';
import ProfilePreview from './ProfilePreview';
import useAdultContentPreference from '../../hooks/useAdultContentPreference';
import logger from '../../utils/logger';

// A field's label and its quiet help line.
const LABEL = 'block text-sm font-medium text-[var(--text-1)] mb-2';
const HELP = 'text-sm text-[var(--text-3)] mt-2';

// Quick picks for the status emoji; any emoji can be typed instead.
const STATUS_EMOJIS = ['📺', '🍿', '🔥', '😭', '💤', '🎧', '📚', '🎮', '✨', '🌸', '🍜', '💀'];
// Overview sections an owner can hide (keys match the API's hidden_sections),
// grouped as the profile lays them out. A row without a key is a group label.
const PROFILE_SECTIONS = [
    { key: null, label: 'Header' },
    { key: 'now_watching', label: 'Watching now', nested: true },
    { key: null, label: 'Main column' },
    { key: 'stats', label: 'Stats', nested: true },
    { key: 'watching', label: 'Watching', nested: true },
    { key: 'favorites', label: 'Favorites', nested: true },
    { key: 'activity', label: 'Activity', nested: true },
    { key: null, label: 'Side column' },
    { key: 'taste', label: 'Taste', nested: true },
    { key: 'characters', label: 'Favorite characters', nested: true },
    { key: 'staff', label: 'Favorite voice actors', nested: true },
];
const STATUS_IDEAS = ['Rewatching an old favorite', 'Catching up on the season', 'Taking a break from anime'];

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
        expression, setExpressionField,
        isSavingProfile,
        profileError,
        profileSuccess,
        setCropModal,
        avatarPreviewUrl, setAvatarPreviewUrl,
        bannerPreviewUrl, setBannerPreviewUrl,
        timezoneOptions,
        resolvedTimezone,
        timezonePreview,
        isBioEdited,
        hasUnsavedChanges,
        handleSaveProfile,
    } = profile;

    const pickedColor = normalizeProfilePrimaryColor(profilePrimaryColor);
    const displayedColor = toneProfileAccentColor(pickedColor);
    const hasAvatar = Boolean(avatarPreviewUrl || user?.avatar);
    const hasBanner = Boolean(user?.banner || bannerPreviewUrl) && !removeBanner;
    const hiddenSections = expression?.hidden_sections || [];
    const toggleSection = (key) => setExpressionField(
        'hidden_sections',
        hiddenSections.includes(key) ? hiddenSections.filter((item) => item !== key) : [...hiddenSections, key],
    );
    const previewAvatar = avatarPreviewUrl || (removeAvatar ? null : user?.avatar);
    const previewBanner = bannerPreviewUrl || (removeBanner ? null : user?.banner);

    const pickAvatar = (e) => {
        const file = e.target.files?.[0];
        if (file) {
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
                setCropModal({ isOpen: true, imageSrc: url, sourceMimeType: file.type || '', type: 'avatar' });
            }
        }
        // Reset the input so picking the same file again still fires onChange.
        e.target.value = null;
    };
    const pickBanner = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setCropModal({ isOpen: true, imageSrc: URL.createObjectURL(file), sourceMimeType: file.type || '', type: 'banner' });
            setRemoveBanner(false);
        }
        e.target.value = null;
    };
    const dropAvatar = () => {
        // Only a saved avatar needs removing on the server; an unsaved pick is just discarded.
        setRemoveAvatar(Boolean(user?.avatar));
        setAvatarFile(null);
        setAvatarPreviewUrl((currentUrl) => {
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            return null;
        });
    };
    const dropBanner = () => {
        setRemoveBanner(Boolean(user?.banner));
        setBannerFile(null);
        setBannerPreviewUrl(null);
    };

    const customColor = !PROFILE_COLOR_PRESETS.includes(pickedColor);
    const SWATCH_SELECTED = 'ring-2 ring-[var(--text-1)] ring-offset-2 ring-offset-[var(--ink-1)]';

    return (
        <>
        <section className="panel animate-fade-in">
            <h2 className="section-title mb-5">Your profile</h2>

            <p className="mb-2 text-sm text-[var(--text-3)]">How visitors see your header</p>
            <ProfilePreview
                username={username || user?.username}
                displayName={expression?.display_name}
                pronouns={expression?.pronouns}
                location={expression?.location}
                statusEmoji={expression?.status_emoji}
                statusText={expression?.status_text}
                avatarUrl={previewAvatar}
                bannerUrl={previewBanner}
                primaryColor={pickedColor}
                badges={user?.badges || []}
                links={(socialLinks || []).filter((link) => link.platform?.trim() && link.value?.trim())}
            />

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-center gap-1">
                    <label className="btn-secondary cursor-pointer px-4 text-sm focus-within:ring-2 focus-within:ring-[var(--color-focus-ring)]">
                        Change picture
                        <input type="file" accept="image/*" onChange={pickAvatar} className="sr-only" />
                    </label>
                    {hasAvatar && !removeAvatar && (
                        <button type="button" onClick={dropAvatar} aria-label="Remove picture" className="min-h-11 px-2 text-sm text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]">Remove</button>
                    )}
                </div>
                <span aria-hidden="true" className="hidden h-6 w-px bg-[var(--line-2)] sm:block" />
                <div className="flex flex-wrap items-center gap-1">
                    <label className="btn-secondary cursor-pointer px-4 text-sm focus-within:ring-2 focus-within:ring-[var(--color-focus-ring)]">
                        Change banner
                        <input type="file" accept="image/*" onChange={pickBanner} className="sr-only" />
                    </label>
                    {hasBanner && (
                        <button type="button" onClick={dropBanner} aria-label="Remove banner" className="min-h-11 px-2 text-sm text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]">Remove</button>
                    )}
                </div>
            </div>
            {(removeAvatar || removeBanner) && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-[var(--text-2)]">
                    {removeAvatar && removeBanner
                        ? 'Picture and banner will be removed on save.'
                        : removeAvatar ? 'Picture will be removed on save.' : 'Banner will be removed on save.'}
                    <button
                        type="button"
                        onClick={() => { setRemoveAvatar(false); setRemoveBanner(false); }}
                        className="text-link"
                    >
                        Undo
                    </button>
                </p>
            )}
            <p className={HELP}>Saved as WebP without photo metadata. Animated GIF pictures stay animated up to 512×512.</p>

            <div className="mt-7">
                <p className={LABEL}>Profile color</p>
                <div className="flex flex-wrap items-center gap-2.5">
                    {PROFILE_COLOR_PRESETS.map((color) => {
                        const isSelected = pickedColor === color;
                        return (
                            <button
                                key={color}
                                type="button"
                                onClick={() => setProfilePrimaryColor(color)}
                                aria-pressed={isSelected}
                                className={`h-8 w-8 rounded-full transition-shadow duration-150 ${isSelected ? SWATCH_SELECTED : ''}`}
                                style={{ backgroundColor: color }}
                                title={color}
                                aria-label={`Set profile color ${color}`}
                            />
                        );
                    })}
                    <span aria-hidden="true" className="mx-1.5 h-6 w-px bg-[var(--line-2)]" />
                    <label
                        className={`relative flex h-8 cursor-pointer items-center gap-2 rounded-full pl-1 pr-3 text-sm transition-colors ${customColor ? `${SWATCH_SELECTED} bg-white/[0.06] text-[var(--text-1)]` : 'bg-white/[0.06] text-[var(--text-2)] hover:bg-white/[0.1] hover:text-[var(--text-1)]'}`}
                        title={`Shown as ${displayedColor}`}
                    >
                        <span
                            aria-hidden="true"
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={customColor ? { backgroundColor: displayedColor } : undefined}
                            data-testid="profile-color-preview"
                        >
                            {!customColor && <Pipette className="h-3.5 w-3.5" />}
                        </span>
                        {customColor ? <span className="font-mono text-[13px] tabular">{pickedColor}</span> : 'Custom'}
                        <input
                            type="color"
                            value={pickedColor}
                            onChange={(e) => setProfilePrimaryColor(normalizeProfilePrimaryColor(e.target.value))}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label="Choose profile primary color"
                        />
                    </label>
                </div>
                {displayedColor !== pickedColor && (
                    <p className="text-sm text-[var(--text-3)] mt-1">
                        Adjusted for readability
                        <span className="sr-only">: shown as {displayedColor}</span>
                    </p>
                )}
            </div>

            <div className="mt-7 grid gap-x-5 gap-y-6 sm:grid-cols-2">
                <div>
                    <label htmlFor="settings-display-name" className={LABEL}>Display name</label>
                    <input
                        id="settings-display-name"
                        type="text"
                        maxLength={40}
                        value={expression?.display_name || ''}
                        onChange={(e) => setExpressionField('display_name', e.target.value)}
                        className="input h-11 w-full py-0"
                        placeholder={user?.username || 'How your name is shown'}
                    />
                </div>
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
                        className="input h-11 w-full py-0"
                        placeholder="Your username"
                    />
                    <p className={HELP}>You can change it once every 14 days.</p>
                </div>
                <div>
                    <label htmlFor="settings-pronouns" className={LABEL}>Pronouns</label>
                    <input
                        id="settings-pronouns"
                        type="text"
                        maxLength={30}
                        value={expression?.pronouns || ''}
                        onChange={(e) => setExpressionField('pronouns', e.target.value)}
                        className="input h-11 w-full py-0"
                        placeholder="she/her, he/him, they/them"
                    />
                </div>
                <div>
                    <label htmlFor="settings-location" className={LABEL}>Location</label>
                    <input
                        id="settings-location"
                        type="text"
                        maxLength={40}
                        value={expression?.location || ''}
                        onChange={(e) => setExpressionField('location', e.target.value)}
                        className="input h-11 w-full py-0"
                        placeholder="Optional"
                    />
                </div>

                <fieldset className="sm:col-span-2">
                    <legend className={LABEL}>Status</legend>
                    <div className="flex gap-3">
                        <input
                            type="text"
                            maxLength={16}
                            value={expression?.status_emoji || ''}
                            onChange={(e) => setExpressionField('status_emoji', e.target.value.replace(/[\sA-Za-z0-9]/g, ''))}
                            className="input h-11 w-11 shrink-0 rounded-full px-0 py-0 text-center text-lg"
                            placeholder="🙂"
                            aria-label="Status emoji"
                        />
                        <div className="relative min-w-0 flex-1">
                            <input
                                type="text"
                                maxLength={80}
                                value={expression?.status_text || ''}
                                onChange={(e) => setExpressionField('status_text', e.target.value)}
                                className="input h-11 w-full py-0 pr-20"
                                placeholder="What are you up to?"
                                aria-label="Status text"
                            />
                            {(expression?.status_text || expression?.status_emoji) && (
                                <button
                                    type="button"
                                    onClick={() => { setExpressionField('status_text', ''); setExpressionField('status_emoji', ''); }}
                                    className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md px-2.5 text-sm text-[var(--text-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-1)]"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="-ml-1.5 mt-2 flex flex-wrap gap-0.5" role="group" aria-label="Pick an emoji">
                        {STATUS_EMOJIS.map((emoji) => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => setExpressionField('status_emoji', emoji)}
                                aria-pressed={expression?.status_emoji === emoji}
                                className="group flex h-11 w-11 items-center justify-center"
                                aria-label={`Use ${emoji}`}
                            >
                                <span
                                    aria-hidden="true"
                                    className={`flex h-8 w-8 items-center justify-center rounded-full text-lg transition-colors ${expression?.status_emoji === emoji ? 'bg-white/[0.1] ring-2 ring-[var(--signature)]' : 'bg-white/[0.04] group-hover:bg-white/[0.08]'}`}
                                >
                                    {emoji}
                                </span>
                            </button>
                        ))}
                    </div>
                    {!expression?.status_text && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {STATUS_IDEAS.map((idea) => (
                                <button
                                    key={idea}
                                    type="button"
                                    onClick={() => setExpressionField('status_text', idea)}
                                    className="min-h-9 rounded-lg bg-white/[0.05] px-3 text-sm text-[var(--text-2)] transition-colors hover:bg-white/[0.1] hover:text-[var(--text-1)]"
                                >
                                    {idea}
                                </button>
                            ))}
                        </div>
                    )}
                </fieldset>


                <div className="sm:col-span-2 sm:max-w-[calc(50%-0.625rem)]">
                    <p className={LABEL}>Timezone</p>
                    <CustomSelect
                        value={preferredTimezone}
                        onChange={(value) => setPreferredTimezone(normalizeTimeZonePreference(value))}
                        options={timezoneOptions}
                        triggerClassName="h-11 w-full !rounded-lg !py-0 !font-normal"
                        menuClassName="max-h-72"
                        placeholder="Select timezone"
                        ariaLabel="Select preferred timezone"
                    />
                    <p className={HELP}>
                        {preferredTimezone === AUTO_TIMEZONE_VALUE ? 'Auto-detected' : resolvedTimezone}
                        {timezonePreview ? ` · ${timezonePreview}` : ''}
                    </p>
                </div>
            </div>
        </section>

        <section className="panel mt-6">
            <div className="mb-1 flex items-baseline justify-between gap-4">
                <h2 className="section-title">Bio</h2>
                <span className={`text-sm tabular ${bio.length > 4900 ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}>
                    {bio.length}/5000
                </span>
            </div>
            <p className="mb-4 text-sm text-[var(--text-3)]">Markdown works here.</p>
            {/* The editor's toolbar buttons are small; on touch screens
                every one of them gets a 44 px target. */}
            <div className="settings-bio overflow-hidden rounded-[var(--radius-md)] max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
                <RichTextEditor
                    value={bio}
                    onChange={(newBio) => {
                        if (newBio.length <= 5000) {
                            setBio(newBio);
                        }
                    }}
                    placeholder="A few words about you"
                    editorMinRows={6}
                    editorMaxRows={10}
                    stackDesktopPreview
                    showPreviewWhenDirty
                    isDirty={isBioEdited}
                    showCharCount={false}
                    editorTextClassName="text-sm leading-[1.6] text-[var(--text-2)] placeholder:text-[var(--text-3)]"
                    previewClassName="overview-about-markdown"
                />
            </div>
            {bio.length > 4900 && (
                <p className="text-sm text-[var(--danger)] mt-2">
                    {5000 - bio.length} characters remaining
                </p>
            )}
        </section>

        <section className="panel mt-6" id="sections">
            <h2 className="section-title">Sections</h2>
            <ul className="mt-2">
                {PROFILE_SECTIONS.map((section) => {
                    const labelId = `settings-section-${section.key}`;
                    return (
                        <li key={section.key || section.label} className={`flex items-center justify-between gap-4 ${section.key ? 'min-h-11' : 'pb-1 [&:not(:first-child)]:mt-5'}`}>
                            <span id={labelId} className={section.key ? 'text-[15px] text-[var(--text-1)]' : 'text-[13px] font-medium text-[var(--text-3)]'}>
                                {section.label}
                            </span>
                            {section.key ? (
                                <SettingsSwitch
                                    checked={!hiddenSections.includes(section.key)}
                                    onClick={() => toggleSection(section.key)}
                                    labelledBy={labelId}
                                />
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </section>

        <section className="panel mt-6">
            <SocialLinksEditor
                socialLinks={socialLinks}
                setSocialLinks={setSocialLinks}
                isSavingProfile={isSavingProfile}
            />
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line-2)] py-4 md:sticky md:bottom-0 md:z-20 md:bg-[var(--ink-0)]">
            <button
                type="button"
                onClick={isSavingProfile ? undefined : handleSaveProfile}
                aria-disabled={isSavingProfile || undefined}
                className="btn-primary"
            >
                {isSavingProfile ? 'Saving…' : 'Save profile'}
            </button>
            {profileError ? (
                <p role="alert" className="text-sm text-[var(--danger)]">{profileError}</p>
            ) : profileSuccess ? (
                <p role="status" className="text-sm text-[var(--text-2)]">{profileSuccess}</p>
            ) : hasUnsavedChanges ? (
                <p className="text-sm text-[var(--text-3)]">Unsaved changes</p>
            ) : null}
        </div>

        <div className="mt-6">
            <ContentCard />
        </div>
        </>
    );
}
