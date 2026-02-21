import { User } from 'lucide-react';
import { Link } from 'react-router-dom';
import SocialLinks, { decodeHtmlEntities } from './SocialLinks';
import UserBadges from './UserBadges';
import FollowButton from '../FollowButton';

export default function ProfileHeader({
    displayUser,
    isPublicView,
    isOwnProfile,
    targetUsername,
    onRefetchProfile,
    onOpenFollowersModal,
}) {
    if (!displayUser) return null;

    return (
        <div className="relative">
            <div className="relative h-48 sm:h-64 md:h-80 lg:h-96 overflow-hidden">
                {displayUser?.banner ? (
                    <>
                        <img
                            src={displayUser.banner}
                            alt={`${displayUser.username}'s profile banner`}
                            className="w-full h-full object-cover scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-dark/30 via-transparent to-dark" />
                    </>
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-accent/40 via-dark-200 to-purple-900/60 animate-gradient-shift" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-dark to-transparent" />
            </div>

            <div className="max-w-7xl mx-auto px-4 relative -mt-12 sm:-mt-16 md:-mt-20 lg:-mt-24 z-10">
                <div className="flex flex-col md:flex-row items-center md:items-start gap-5 md:gap-8">
                    <div className="relative shrink-0">
                        <div className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 lg:w-36 lg:h-36 rounded-2xl bg-dark-100 p-1.5 shadow-2xl">
                            <div className="w-full h-full rounded-xl border-2 border-white/20 overflow-hidden relative">
                                {displayUser?.avatar ? (
                                    <img
                                        src={displayUser.avatar}
                                        alt={displayUser.username}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                        <User className="w-16 h-16 text-white" />
                                    </div>
                                )}
                            </div>
                        </div>
                        {displayUser?.is_online ? (
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-dark shadow-lg" title="Online" />
                        ) : (
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gray-500 rounded-full border-4 border-dark shadow-lg" title="Offline" />
                        )}
                    </div>

                    <div className="flex-1 text-center md:text-left pt-2 md:pt-4 w-full">
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 md:gap-3 mb-3">
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tight">
                                {displayUser?.username}
                            </h1>
                        </div>

                        <div className="flex items-center gap-3 justify-center md:justify-start mb-4 text-sm">
                            <button
                                onClick={() => onOpenFollowersModal('followers')}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="font-semibold text-white">{(displayUser?.followers_count ?? 0).toLocaleString()}</span>{' '}
                                <span className="text-gray-500">followers</span>
                            </button>
                            <span className="text-gray-700">•</span>
                            <button
                                onClick={() => onOpenFollowersModal('following')}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="font-semibold text-white">{(displayUser?.following_count ?? 0).toLocaleString()}</span>{' '}
                                <span className="text-gray-500">following</span>
                            </button>
                        </div>

                        {displayUser?.bio && (
                            <p className="text-gray-300 text-sm md:text-[15px] max-w-xl mb-5 leading-6 whitespace-pre-wrap">
                                {decodeHtmlEntities(displayUser.bio)}
                            </p>
                        )}

                        <SocialLinks links={displayUser?.social_links} />
                    </div>

                    <div className="flex items-center gap-2 md:gap-3 justify-center md:justify-end pt-2 md:pt-4 shrink-0 w-full md:w-auto">
                        {!isPublicView ? (
                            <Link
                                to="/settings"
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all border border-white/10 text-sm font-medium active:scale-95 flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c.94-1.543-.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="hidden sm:inline">Edit Profile</span>
                                <span className="sm:hidden">Edit</span>
                            </Link>
                        ) : (
                            <FollowButton
                                username={targetUsername}
                                initialIsFollowing={displayUser?.is_following}
                                onSuccess={() => isPublicView && onRefetchProfile()}
                                className="px-4 md:px-6"
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
