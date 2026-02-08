import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { followApi } from '../api/client';
import { X, Users, UserCheck, Loader2, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import FollowButton from './FollowButton';

export default function FollowersModal({
    username,
    type = 'followers', // 'followers' | 'following'
    isOpen,
    onClose
}) {
    const [activeTab, setActiveTab] = useState(type);

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError
    } = useInfiniteQuery({
        queryKey: ['follows', username, activeTab],
        queryFn: async ({ pageParam = 1 }) => {
            const apiCall = activeTab === 'followers'
                ? followApi.getFollowers
                : followApi.getFollowing;
            const response = await apiCall(username, { page: pageParam });
            return response.data;
        },
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                const url = new URL(lastPage.next);
                return url.searchParams.get('page');
            }
            return undefined;
        },
        enabled: isOpen,
    });

    if (!isOpen) return null;

    const allUsers = data?.pages.flatMap(page => page.results) || [];

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight * 1.5 && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-dark-100 border border-gray-800 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <h2 className="text-lg font-bold text-white">@{username}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-800">
                    <button
                        onClick={() => setActiveTab('followers')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'followers'
                                ? 'text-accent border-b-2 border-accent'
                                : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        <Users className="w-4 h-4" />
                        Followers
                    </button>
                    <button
                        onClick={() => setActiveTab('following')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'following'
                                ? 'text-accent border-b-2 border-accent'
                                : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        <UserCheck className="w-4 h-4" />
                        Following
                    </button>
                </div>

                {/* User List */}
                <div
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto p-2 custom-scrollbar"
                >
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                        </div>
                    ) : isError ? (
                        <div className="text-center py-8 text-gray-400">
                            <p>Failed to load {activeTab}</p>
                        </div>
                    ) : allUsers.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>No {activeTab} yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {allUsers.map((item) => (
                                <UserListItem
                                    key={item.id}
                                    user={item.user}
                                    onClose={onClose}
                                    isFollowing={activeTab === 'following'}
                                />
                            ))}
                            {isFetchingNextPage && (
                                <div className="flex justify-center py-4">
                                    <Loader2 className="w-5 h-5 animate-spin text-accent" />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function UserListItem({ user, onClose, isFollowing = false }) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-800/50 transition-colors group">
            <Link
                to={`/profile/${user.username}`}
                onClick={onClose}
                className="flex items-center gap-3 flex-1 min-w-0"
            >
                {/* Avatar */}
                {user.avatar ? (
                    <img
                        src={user.avatar}
                        alt={user.username}
                        className="w-12 h-12 rounded-full object-cover border-2 border-gray-700 group-hover:border-accent/50 transition-colors"
                    />
                ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent/30 to-pink-500/30 flex items-center justify-center border-2 border-gray-700">
                        <span className="text-lg font-bold text-white">
                            {user.username[0].toUpperCase()}
                        </span>
                    </div>
                )}

                {/* User Info */}
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate group-hover:text-accent transition-colors">
                        {user.username}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Sparkles className="w-3 h-3 text-yellow-500" />
                        <span>{user.points || 0} points</span>
                    </div>
                </div>
            </Link>

            {/* Follow Button */}
            <FollowButton
                username={user.username}
                variant="compact"
                initialIsFollowing={isFollowing}
            />
        </div>
    );
}
