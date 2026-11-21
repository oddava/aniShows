import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFriendsWatching } from '../hooks/useFriendsWatching';
import { statusLabel } from '../utils/listStatus';

const MAX_DISPLAYED = 6;

function friendLine(friend) {
    const { status, score, episodes_watched: episodesWatched, anime } = friend;
    if (status === 'Completed' && score > 0) return `Scored ${score}/10`;
    if (status === 'Watching') {
        return anime?.episode_count
            ? `Episode ${episodesWatched} of ${anime.episode_count}`
            : `Episode ${episodesWatched}`;
    }
    return statusLabel(status) || status;
}

function FriendAvatar({ friend }) {
    const [showTooltip, setShowTooltip] = useState(false);
    const user = friend.user;
    const line = friendLine(friend);

    return (
        <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <Link
                to={`/u/${user.username}`}
                aria-label={`${user.username}: ${line}`}
                onFocus={() => setShowTooltip(true)}
                onBlur={() => setShowTooltip(false)}
                className="block h-10 w-10 overflow-hidden rounded-full bg-[var(--ink-3)] transition-opacity hover:opacity-80"
            >
                {user.avatar ? (
                    <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                    <span className="flex h-full w-full items-center justify-center text-sm font-medium text-[var(--text-2)]">
                        {user.username[0].toUpperCase()}
                    </span>
                )}
            </Link>

            {showTooltip && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2" aria-hidden="true">
                    <div className="whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--ink-3)] px-3 py-2 shadow-lg shadow-black/30">
                        <p className="text-[13px] font-medium text-[var(--text-1)]">{user.username}</p>
                        <p className="mt-0.5 text-[13px] text-[var(--text-2)]">{line}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Mutual follows who have this anime on their list. Shown only when there is
 * someone to show: no loading placeholder, no empty pitch.
 */
export default function FriendsWatching({ animeId }) {
    const { friends, total, loading, error, refetch } = useFriendsWatching(animeId);

    if (loading) return null;

    if (error) {
        return (
            <section className="panel" aria-labelledby="friends-watching-heading">
                <h2 id="friends-watching-heading" className="section-title mb-2">Friends watching</h2>
                <p className="text-sm text-[var(--text-2)]" role="alert">
                    Couldn’t load friends watching.{' '}
                    <button type="button" onClick={() => refetch()} className="text-link">
                        Try again
                    </button>
                </p>
            </section>
        );
    }

    if (friends.length === 0) return null;

    const displayedFriends = friends.slice(0, MAX_DISPLAYED);
    const remainingCount = Math.max(total, friends.length) - displayedFriends.length;

    return (
        <section className="panel" aria-labelledby="friends-watching-heading">
            <h2 id="friends-watching-heading" className="section-title mb-3">Friends watching</h2>
            <div className="flex flex-wrap items-center gap-3">
                {displayedFriends.map((friend) => (
                    <FriendAvatar key={friend.user.id} friend={friend} />
                ))}
                {remainingCount > 0 && (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] text-sm text-[var(--text-2)] tabular">
                        +{remainingCount}
                    </span>
                )}
            </div>
        </section>
    );
}
