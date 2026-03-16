import { Link } from 'react-router-dom';
import { Users, Eye } from 'lucide-react';
import { useFriendsWatching } from '../hooks/useFriendsWatching';
import { useState } from 'react';

function FriendAvatar({ friend, accentColor }) {
    const [showTooltip, setShowTooltip] = useState(false);
    const user = friend.user;
    const status = friend.status;
    const score = friend.score;
    const episodesWatched = friend.episodes_watched;
    const anime = friend.anime;

    const getStatusText = () => {
        switch (status) {
            case 'Completed':
                return score > 0 ? `Scored ${score}/10` : 'Completed';
            case 'Watching':
                return anime.episode_count 
                    ? `Ep ${episodesWatched}/${anime.episode_count}`
                    : `Ep ${episodesWatched}`;
            case 'On Hold':
                return 'On Hold';
            case 'Dropped':
                return 'Dropped';
            case 'Plan to Watch':
                return 'Plan to Watch';
            default:
                return status;
        }
    };

    return (
        <div 
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <Link
                to={`/u/${user.username}`}
                className="block w-10 h-10 rounded-full overflow-hidden bg-gray-700 ring-2 ring-transparent hover:ring-gray-600 transition-all"
            >
                {user.avatar ? (
                    <img 
                        src={user.avatar} 
                        alt={user.username}
                        className="w-full h-full object-cover" 
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm font-medium"
                        style={{ backgroundColor: accentColor || '#374151' }}
                    >
                        {user.username[0].toUpperCase()}
                    </div>
                )}
            </Link>
            
            {/* Tooltip */}
            {showTooltip && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50"
                >
                    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-lg whitespace-nowrap"
                    >
                        <p className="text-white font-medium text-sm">{user.username}</p>
                        <p className="text-gray-400 text-xs mt-0.5">{getStatusText()}</p>
                        {/* Arrow */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
                            <div className="w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function FriendsWatching({ animeId, accentColor }) {
    const { friends, loading, error } = useFriendsWatching(animeId);

    if (loading) {
        return (
            <div className="bg-dark-100/30 rounded-2xl p-6 border border-gray-800">
                <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                    <h3 className="text-lg font-bold text-white">Friends Watching</h3>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-800 animate-pulse"></div>
                    <div className="w-8 h-8 rounded-full bg-gray-800 animate-pulse"></div>
                    <div className="w-8 h-8 rounded-full bg-gray-800 animate-pulse"></div>
                </div>
            </div>
        );
    }

    if (error || friends.length === 0) {
        return (
            <div className="bg-dark-100/30 rounded-2xl p-6 border border-gray-800">
                <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                    <h3 className="text-lg font-bold text-white">Friends Watching</h3>
                </div>
                <p className="text-gray-500 text-sm">
                    Connect with friends to see who's watching this anime.
                </p>
            </div>
        );
    }

    const MAX_DISPLAYED = 6;
    const displayedFriends = friends.slice(0, MAX_DISPLAYED);
    const remainingCount = friends.length - MAX_DISPLAYED;

    return (
        <div className="bg-dark-100/30 rounded-2xl p-6 border border-gray-800">
            <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                <h3 className="text-lg font-bold text-white">Friends Watching</h3>
            </div>

            <div className="flex flex-wrap gap-3 items-center">
                {displayedFriends.map((friend) => (
                    <FriendAvatar 
                        key={friend.user.id} 
                        friend={friend} 
                        accentColor={accentColor}
                    />
                ))}
                {remainingCount > 0 && (
                    <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-sm font-medium text-gray-400">
                        +{remainingCount}
                    </div>
                )}
            </div>
        </div>
    );
}