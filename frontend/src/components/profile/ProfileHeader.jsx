import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Link2, MapPin, Pencil } from 'lucide-react';
import FollowButton from '../FollowButton';
import ProfileAvatar from './ProfileAvatar';
import UserBadges from './UserBadges';
import NowWatchingCard from './NowWatchingCard';
import { PlatformIcon } from './SocialLinks';

function linkHref(link) {
    const raw = link?.url || link?.value || '';
    if (!raw) return null;
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function ShareButton({ username }) {
    const [copied, setCopied] = useState(false);
    const share = async () => {
        const url = `${window.location.origin}/u/${username}`;
        try {
            if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) {
                await navigator.share({ title: `${username} on AniShows`, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            // Share sheet dismissed or clipboard blocked: nothing to report.
        }
    };
    return (
        <>
            <button type="button" onClick={share} className="profile-icon-btn" aria-label="Share profile" title={copied ? 'Link copied' : 'Share profile'}>
                {copied ? <Check aria-hidden="true" className="h-[18px] w-[18px]" /> : <Link2 aria-hidden="true" className="h-[18px] w-[18px]" />}
            </button>
            <span role="status" className="sr-only">{copied ? 'Profile link copied' : ''}</span>
        </>
    );
}

function HeroActions({ displayUser, isPublicView, targetUsername }) {
    return (
        <>
            <ShareButton username={displayUser.username} />
            {!isPublicView ? (
                <Link to="/settings" className="btn-secondary gap-2 px-4 text-[15px]">
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                    Edit profile
                </Link>
            ) : (
                <FollowButton
                    username={targetUsername}
                    initialIsFollowing={displayUser.is_following}
                    initialIsFollower={displayUser.is_follower}
                    tone="dark"
                    showLabelOnMobile
                    className="min-h-[2.75rem] px-5 text-[15px]"
                />
            )}
        </>
    );
}

/**
 * The top of a profile, set like X's: a tall full-bleed banner (a flat tint
 * of the person's colour when there is none), the avatar overlapping its
 * foot, then who they are in one quiet column: name, handle and pronouns,
 * their status, where they are and their links, then follow counts. What they are
 * watching sits on the right.
 */
/** A link's text: the handle for X (its logo already says "X"), else the platform. */
function linkLabel(link) {
    const platform = link?.platform || 'Link';
    if (!/^(x|twitter)$/i.test(platform)) return platform;
    const raw = String(link?.url || link?.value || '').trim();
    const handle = raw.replace(/^https?:\/\//i, '').replace(/^(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    return handle ? `@${handle}` : platform;
}

export default function ProfileHeader({
    displayUser,
    isPublicView,
    isPrivate = false,
    targetUsername,
    onOpenFollowersModal,
}) {
    if (!displayUser) return null;

    const username = displayUser.username;
    const displayName = displayUser.display_name?.trim() || username;
    const hasDisplayName = displayName !== username;
    const following = displayUser.following_count ?? 0;
    const followers = displayUser.followers_count ?? 0;
    const links = (displayUser.social_links || []).filter((link) => linkHref(link));
    const handle = [hasDisplayName ? `@${username}` : null, displayUser.pronouns || null].filter(Boolean);

    return (
        <header className="profile-hero">
            <div className={`profile-hero__banner relative w-full overflow-hidden ${displayUser.banner ? '' : 'profile-hero__banner--empty'}`}>
                {displayUser.banner ? (
                    <img src={displayUser.banner} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
                ) : (
                    <div aria-hidden="true" className="profile-hero__fill absolute inset-0" />
                )}
            </div>

            <div className="page-container">
                <div className="profile-hero__identity flex items-end justify-between gap-4">
                    <ProfileAvatar
                        avatar={displayUser.avatar}
                        username={username}
                        className="relative h-24 w-24 border-4 border-[var(--ink-0)] text-4xl sm:h-36 sm:w-36 sm:text-5xl"
                    />
                    <div className="flex items-center gap-2 pb-1">
                        <HeroActions displayUser={displayUser} isPublicView={isPublicView} targetUsername={targetUsername} />
                    </div>
                </div>

                <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
                    <div className="min-w-0">
                        <h1 className="profile-hero__name break-words">{displayName}</h1>
                        {(handle.length > 0 || displayUser.badges?.length > 0) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                                {handle.length > 0 && (
                                    <p className="text-[15px] text-[var(--text-3)]">{handle.join(' · ')}</p>
                                )}
                                <UserBadges user={displayUser} />
                            </div>
                        )}

                        {(displayUser.status_emoji || displayUser.status_text) && (
                            <p className="profile-status mt-3 flex w-fit max-w-full items-start gap-2 rounded-xl px-3.5 py-2 text-[15px] leading-snug text-[var(--text-1)] sm:mt-4 sm:max-w-2xl">
                                {displayUser.status_emoji && <span aria-hidden="true">{displayUser.status_emoji}</span>}
                                <span className="min-w-0 break-words">{displayUser.status_text}</span>
                            </p>
                        )}

                        {(displayUser.location || links.length > 0) && (
                        <div className="mt-0.5 grid grid-cols-2 items-center gap-x-4 text-sm text-[var(--text-2)] md:mt-4 md:flex md:flex-wrap md:gap-x-5 md:gap-y-1">
                            {displayUser.location && (
                                <span className="inline-flex min-h-11 min-w-0 items-center gap-1.5 md:min-h-0">
                                    <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-3)]" />
                                    <span className="truncate">{displayUser.location}</span>
                                </span>
                            )}
                            {links.map((link, index) => {
                                const suspicious = link.trust_level === 'suspicious';
                                return (
                                    <a
                                        key={`${link.platform}-${index}`}
                                        href={linkHref(link)}
                                        target="_blank"
                                        rel={suspicious ? 'noopener noreferrer nofollow ugc' : 'noopener noreferrer'}
                                        title={suspicious ? 'Flagged as possibly unsafe. Open with care.' : linkHref(link)}
                                        className="profile-link"
                                    >
                                        <span className="text-[var(--text-3)]"><PlatformIcon platform={link.platform} /></span>
                                        {linkLabel(link)}
                                        {suspicious && <span className="sr-only"> (possibly unsafe)</span>}
                                    </a>
                                );
                            })}
                        </div>
                        )}

                        <p className="flex flex-wrap items-center gap-x-5 text-sm text-[var(--text-2)] tabular md:mt-4">
                            <button
                                type="button"
                                onClick={() => onOpenFollowersModal('following')}
                                className="min-h-10 transition-colors hover:text-[var(--text-1)] md:min-h-0"
                            >
                                <strong className="font-semibold text-[var(--signature)]">{following.toLocaleString()}</strong> Following
                            </button>
                            <button
                                type="button"
                                onClick={() => onOpenFollowersModal('followers')}
                                className="min-h-10 transition-colors hover:text-[var(--text-1)] md:min-h-0"
                            >
                                <strong className="font-semibold text-[var(--signature)]">{followers.toLocaleString()}</strong> {followers === 1 ? 'Follower' : 'Followers'}
                            </button>
                        </p>
                    </div>

                    {!isPrivate && !(displayUser.hidden_sections || []).includes('now_watching') && (
                        <NowWatchingCard username={username} />
                    )}
                </div>
            </div>
        </header>
    );
}
