import { MapPin } from 'lucide-react';
import UserBadges from '../profile/UserBadges';
import { PlatformIcon } from '../profile/SocialLinks';
import { toneProfileAccentColor } from '../../utils/profileAccent';

/**
 * A live preview of the profile header while it is being edited, as in
 * Discord's profile editor: banner (or the flat colour), avatar, name,
 * handle, status strip, location and the Follow button in the picked colour,
 * all from the unsaved form. Set like the real header.
 */
/** A link's text: the handle for X (its logo already says "X"), else the platform. */
function linkLabel(link) {
    const platform = link?.platform || 'Link';
    if (!/^(x|twitter)$/i.test(platform)) return platform;
    const raw = String(link?.url || link?.value || '').trim();
    const handle = raw.replace(/^https?:\/\//i, '').replace(/^(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    return handle ? `@${handle}` : platform;
}

export default function ProfilePreview({
    username,
    displayName,
    pronouns,
    location,
    statusEmoji,
    statusText,
    avatarUrl,
    bannerUrl,
    primaryColor,
    badges = [],
    links = [],
}) {
    const accent = toneProfileAccentColor(primaryColor);
    const name = displayName?.trim() || username;
    const handle = [name !== username ? `@${username}` : null, pronouns?.trim() || null].filter(Boolean).join(' · ');
    const hasStatus = Boolean(statusEmoji || statusText?.trim());

    return (
        <figure className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-0)]" aria-label="Preview of your profile header">
            <div className="relative aspect-[9/2] min-h-24 bg-[var(--ink-2)]">
                {bannerUrl ? (
                    <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                    <div aria-hidden="true" className="absolute inset-0" style={{ background: `color-mix(in srgb, ${accent} 28%, var(--ink-1))` }} />
                )}
            </div>
            <div className="px-4 pb-4">
                <div className="flex items-end justify-between gap-3">
                    <span className="relative -mt-10 block h-20 w-20 overflow-hidden rounded-full border-4 border-[var(--ink-0)] bg-[var(--ink-2)]">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                            <span className="flex h-full w-full items-center justify-center text-2xl font-semibold uppercase text-[var(--text-2)]">
                                {username?.charAt(0) || '?'}
                            </span>
                        )}
                    </span>
                    <span
                        aria-hidden="true"
                        className="mt-2 inline-flex h-8 items-center rounded-lg px-3.5 text-sm font-medium"
                        style={{ backgroundColor: accent, color: 'var(--on-signature)' }}
                    >
                        Follow
                    </span>
                </div>
                <p className="mt-2 truncate text-xl font-semibold tracking-[-0.03em] text-[var(--text-1)]">{name}</p>
                {(handle || badges.length > 0) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {handle && <p className="truncate text-sm text-[var(--text-3)]">{handle}</p>}
                        <UserBadges user={{ badges }} />
                    </div>
                )}
                {hasStatus && (
                    <p
                        className="mt-2.5 flex w-fit max-w-full items-start gap-2 rounded-xl px-3 py-1.5 text-sm text-[var(--text-1)]"
                        style={{ background: `color-mix(in srgb, ${accent} 16%, var(--ink-1))` }}
                    >
                        {statusEmoji && <span aria-hidden="true">{statusEmoji}</span>}
                        <span className="min-w-0 truncate">{statusText}</span>
                    </p>
                )}
                {(location?.trim() || links.length > 0) && (
                    <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-2)]">
                        {location?.trim() && (
                            <span className="inline-flex items-center gap-1.5">
                                <MapPin aria-hidden="true" className="h-4 w-4 text-[var(--text-3)]" />
                                {location}
                            </span>
                        )}
                        {links.map((link, index) => (
                            <span key={`${link.platform}-${index}`} className="inline-flex items-center gap-1.5">
                                <span className="text-[var(--text-3)]"><PlatformIcon platform={link.platform} /></span>
                                {linkLabel(link)}
                            </span>
                        ))}
                    </p>
                )}
            </div>
        </figure>
    );
}
