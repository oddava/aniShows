import { Link } from 'react-router-dom';
import { Users, Eye } from 'lucide-react';

export default function FriendsWatching({ animeId, accentColor }) {
    // Mock data - would come from API
    const friends = [
        // { username: 'friend1', avatar: 'url', status: 'COMPLETED', score: 8 },
        // { username: 'friend2', avatar: 'url', status: 'CURRENT', progress: 12 },
    ];

    if (friends.length === 0) {
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

    return (
        <div className="bg-dark-100/30 rounded-2xl p-6 border border-gray-800">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Users className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                    <h3 className="text-lg font-bold text-white">Friends Watching</h3>
                </div>
                <span className="text-sm text-gray-400">{friends.length} friends</span>
            </div>

            <div className="space-y-3">
                {friends.map((friend) => (
                    <Link
                        key={friend.username}
                        to={`/profile/${friend.username}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-dark-100/50 hover:bg-dark-100 transition-colors group"
                    >
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-700">
                            {friend.avatar ? (
                                <img 
                                    src={friend.avatar} 
                                    alt={friend.username}
                                    className="w-full h-full object-cover" 
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    {friend.username[0].toUpperCase()}
                                </div>
                            )}
                        </div>

                        <div className="flex-1">
                            <p className="font-medium text-white group-hover:text-white/90 transition-colors">
                                {friend.username}
                            </p>
                            <p className="text-xs text-gray-500">
                                {friend.status === 'COMPLETED' ? `Scored ${friend.score}/10` 
                                    : friend.status === 'CURRENT' 
                                        ? `Watching - Ep ${friend.progress}`
                                        : friend.status
                                }
                            </p>
                        </div>

                        <Eye className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                    </Link>
                ))}
            </div>
        </div>
    );
}
