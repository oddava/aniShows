import { User } from 'lucide-react';
import { Link } from 'react-router-dom';
import FollowButton from '../FollowButton';
import UserBadges from './UserBadges';

export default function ProfileHeader({
    displayUser,
    isPublicView,
    targetUsername,
    onOpenFollowersModal,
}) {
    if (!displayUser) return null;

    return (
        <div className="relative mb-8 profile-header">
            {/* Banner */}
            <div className="relative w-full aspect-[2.8/1] sm:aspect-[3.2/1] md:aspect-[4/1] xl:aspect-[4.6/1] 2xl:aspect-[5/1] overflow-hidden bg-dark-200">
                {displayUser?.banner ? (
                    <>
                        <img
                            src={displayUser.banner}
                            alt={`${displayUser.username}'s profile banner`}
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-dark/15 md:bg-dark/25 xl:bg-dark/20" />
                    </>
                ) : (
                    <div className="w-full h-full bg-dark-100" />
                )}
            </div>

            {/* Profile Info Container */}
            <div className="max-w-7xl mx-auto px-4 relative z-10">
                {/* Mobile layout (Twitter-like) */}
                <div className="md:hidden px-2 pt-3">
                    <div className="relative shrink-0 -mt-14">
                        <div className="w-28 h-28 rounded-full bg-dark border-4 border-dark overflow-hidden">
                            {displayUser?.avatar ? (
                                <img src={displayUser.avatar} alt={displayUser.username} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-dark-200 flex items-center justify-center">
                                    <User className="w-16 h-16 text-gray-600" />
                                </div>
                            )}
                        </div>
                        {displayUser?.is_online ? (
                            <div className="absolute bottom-2 right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-dark" title="Online" />
                        ) : (
                            <div className="absolute bottom-2 right-2 w-4 h-4 bg-gray-500 rounded-full border-2 border-dark" title="Offline" />
                        )}
                    </div>

                    <div className="-mt-12 flex justify-end">
                        <div className="shrink-0">
                            {!isPublicView ? (
                                <Link
                                    to="/settings"
                                    className="px-5 py-2 bg-dark-100 hover:bg-dark-50 border border-gray-700 hover:border-accent text-gray-200 hover:text-white rounded-full transition-all duration-200 text-sm font-semibold flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c.94-1.543-.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    Edit profile
                                </Link>
                            ) : (
                                <FollowButton
                                    username={targetUsername}
                                    initialIsFollowing={displayUser?.is_following}
                                    initialIsFollower={displayUser?.is_follower}
                                    className="px-5 py-2 font-semibold rounded-full transition-colors duration-200"
                                />
                            )}
                        </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-2">
                        <div className="flex items-center gap-2 mt-2">
                            <h1 className="text-2xl font-bold text-white tracking-tight">
                                {displayUser?.username}
                            </h1>
                            <UserBadges user={displayUser} />
                        </div>

                        <div className="flex items-center gap-4 text-sm font-medium mt-1">
                            <button
                                onClick={() => onOpenFollowersModal('following')}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="text-white font-bold">{(displayUser?.following_count ?? 0).toLocaleString()}</span>{' '}
                                <span>Following</span>
                            </button>
                            <button
                                onClick={() => onOpenFollowersModal('followers')}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="text-white font-bold">{(displayUser?.followers_count ?? 0).toLocaleString()}</span>{' '}
                                <span>Followers</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Desktop layout (original style) */}
                <div className="hidden md:flex items-start gap-8 px-2 sm:px-4 pt-4">
                    <div className="relative shrink-0 -mt-24">
                        <div className="w-40 h-40 rounded-2xl bg-dark overflow-hidden">
                            {displayUser?.avatar ? (
                                <img src={displayUser.avatar} alt={displayUser.username} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-dark-200 flex items-center justify-center">
                                    <User className="w-20 h-20 text-gray-600" />
                                </div>
                            )}
                        </div>
                        {displayUser?.is_online ? (
                            <div className="absolute bottom-2 right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-dark" title="Online" />
                        ) : (
                            <div className="absolute bottom-2 right-2 w-4 h-4 bg-gray-500 rounded-full border-2 border-dark" title="Offline" />
                        )}
                    </div>

                    <div className="flex-1 flex items-start justify-between w-full gap-4 mt-2">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-4">
                                <h1 className="text-4xl font-bold text-white tracking-tight drop-shadow-md">
                                    {displayUser?.username}
                                </h1>
                                <UserBadges user={displayUser} />
                            </div>

                            <div className="flex items-center gap-4 text-sm font-medium mt-1">
                                <button
                                    onClick={() => onOpenFollowersModal('followers')}
                                    className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
                                >
                                    <span className="text-white font-bold">{(displayUser?.followers_count ?? 0).toLocaleString()}</span>
                                    <span>Followers</span>
                                </button>
                                <span className="text-gray-600">•</span>
                                <button
                                    onClick={() => onOpenFollowersModal('following')}
                                    className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
                                >
                                    <span className="text-white font-bold">{(displayUser?.following_count ?? 0).toLocaleString()}</span>
                                    <span>Following</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 shrink-0 mt-0">
                            {!isPublicView ? (
                                <Link
                                    to="/settings"
                                    className="px-5 py-2.5 bg-dark-100 hover:bg-dark-50 border border-gray-700 hover:border-accent text-gray-300 hover:text-white rounded-xl transition-all duration-200 text-sm font-medium flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c.94-1.543-.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    Edit Profile
                                </Link>
                            ) : (
                                <FollowButton
                                    username={targetUsername}
                                    initialIsFollowing={displayUser?.is_following}
                                    initialIsFollower={displayUser?.is_follower}
                                    className="px-6 py-2.5 font-semibold transition-colors duration-200"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
