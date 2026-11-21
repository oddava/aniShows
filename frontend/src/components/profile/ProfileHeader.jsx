import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import FollowButton from '../FollowButton';
import ProfileAvatar from './ProfileAvatar';
import UserBadges from './UserBadges';
import { listQueries } from '../../api/queries/lists';
import { profileScore } from './profileStats';

const plural = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * The one line under the name: only the numbers that are not zero, each with
 * what it counts. Mean score and its "of N rated" come from the same source.
 */
function statsLine(user, summary) {
    const parts = [];
    const anime = Number(user.anime_count ?? summary?.total) || 0;
    const episodes = Number(user.episodes_watched ?? summary?.episodes_watched) || 0;
    const days = Number(user.days_watched) || 0;
    const { mean, rated } = profileScore(user, summary);
    const favorites = Number(user.favorites_count) || 0;
    const resonance = Number(user.resonance_count) || 0;

    if (anime) parts.push(`${anime.toLocaleString()} on the list`);
    if (episodes) parts.push(`${plural(episodes, 'episode')} watched`);
    if (days) parts.push(`${days} ${Number(days) === 1 ? 'day' : 'days'} of watching`);
    if (rated && mean != null) parts.push(`mean score ${mean} of ${rated} rated`);
    if (favorites) parts.push(plural(favorites, 'favorite'));
    if (resonance) parts.push(`${plural(resonance, 'helpful vote')} on reviews`);
    return parts;
}

/**
 * The top of a profile, set like the home page: picture and name, then
 * one muted line of numbers. A banner shows only when there is one.
 */
export default function ProfileHeader({
    displayUser,
    isPublicView,
    isPrivate = false,
    targetUsername,
    onOpenFollowersModal,
}) {
    const username = displayUser?.username;
    const { data: summary } = useQuery({
        ...listQueries.summary(username),
        enabled: Boolean(username) && !isPrivate,
        staleTime: 60 * 1000,
    });

    if (!displayUser) return null;

    const parts = isPrivate ? [] : statsLine(displayUser, summary);
    const following = displayUser.following_count ?? 0;
    const followers = displayUser.followers_count ?? 0;

    return (
        <header className="profile-header">
            {displayUser.banner && (
                <div className="h-40 w-full overflow-hidden bg-[var(--ink-1)] sm:h-48 lg:h-56">
                    <img
                        src={displayUser.banner}
                        alt={`${username}'s profile banner`}
                        className="h-full w-full object-cover"
                    />
                </div>
            )}

            <div className={`page-container ${displayUser.banner ? 'pt-8 md:pt-10' : 'pt-24 md:pt-32'}`}>
                {/* Phones: the action gets its own row under the name and numbers. */}
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-6">
                    <ProfileAvatar
                        avatar={displayUser.avatar}
                        username={username}
                        className="h-16 w-16 text-2xl sm:h-24 sm:w-24 sm:text-4xl"
                    />

                    <div className="min-w-0">
                        <h1 className="page-title break-words">{username}</h1>

                        <UserBadges user={displayUser} className="mt-3" />

                        {parts.length > 0 && (
                            <p className="mt-2.5 max-w-2xl text-[17px] leading-relaxed text-[var(--text-2)] tabular">
                                {parts.join(' · ')}
                            </p>
                        )}

                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[15px] text-[var(--text-3)] tabular">
                            <button
                                type="button"
                                onClick={() => onOpenFollowersModal('following')}
                                className="min-h-[2.75rem] transition-colors hover:text-[var(--text-1)] md:min-h-0"
                            >
                                <span className="text-[var(--text-1)]">{following.toLocaleString()}</span> following
                            </button>
                            <span aria-hidden="true">·</span>
                            <button
                                type="button"
                                onClick={() => onOpenFollowersModal('followers')}
                                className="min-h-[2.75rem] transition-colors hover:text-[var(--text-1)] md:min-h-0"
                            >
                                <span className="text-[var(--text-1)]">{followers.toLocaleString()}</span> {followers === 1 ? 'follower' : 'followers'}
                            </button>
                        </p>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                        {!isPublicView ? (
                            <Link to="/settings" className="btn-secondary px-4 text-[15px]">
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
                    </div>
                </div>
            </div>
        </header>
    );
}
