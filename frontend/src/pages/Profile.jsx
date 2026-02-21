import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { User } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi, reviewApi, authApi } from '../api/client';
import FollowersModal from '../components/FollowersModal';
import useColorExtraction from '../hooks/useColorExtraction';
import {
    ProfileErrorBoundary,
    ProfileHeader,
    ProfileStats,
    ProfileTabs,
    ProfileContent,
} from '../components/profile';
import { setUserContext, initSentry } from '../sentry';

initSentry();

export default function Profile({ forcedUsername }) {
    const { username: paramsUsername } = useParams();
    const username = forcedUsername || paramsUsername;
    const { user: currentUser, isAuthenticated, loading } = useAuth();
    const [activeTab, setActiveTab] = useState('favorites');
    const [viewMode, setViewMode] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [listStatusFilter, setListStatusFilter] = useState('Watching');
    const [showFollowersModal, setShowFollowersModal] = useState(false);
    const [followersModalType, setFollowersModalType] = useState('followers');

    const isPublicView = !!username && username.toLowerCase() !== currentUser?.username?.toLowerCase();
    const isOwnProfile = !isPublicView;
    const targetUsername = isPublicView ? username : currentUser?.username;

    const { data: publicProfile, isLoading: profileLoading, isError, refetch: refetchProfile } = useQuery({
        queryKey: ['profile', targetUsername],
        queryFn: () => authApi.getByUsername(targetUsername).then(res => res.data),
        enabled: isPublicView,
        retry: 2,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    const displayUser = isPublicView ? publicProfile : currentUser;
    const isPrivate = isPublicView && displayUser?.is_private;

    const openFollowersModal = (type) => {
        setFollowersModalType(type);
        setShowFollowersModal(true);
    };

    const {
        data: favoritesData,
        fetchNextPage: fetchNextFavorites,
        hasNextPage: hasNextFavorites,
        isFetchingNextPage: isFetchingNextFavorites,
        isLoading: favoritesLoading
    } = useInfiniteQuery({
        queryKey: ['favorites', targetUsername],
        queryFn: ({ pageParam = 1 }) =>
            favoriteApi.getAll({ username: targetUsername, page: pageParam }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!displayUser && activeTab === 'favorites' && !isPrivate,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    const { data: currentListData, isLoading: listsLoading } = useQuery({
        queryKey: ['lists', targetUsername, listStatusFilter],
        queryFn: () => listApi.getAll({ status: listStatusFilter, username: targetUsername }).then(res => res.data.results || res.data || []),
        enabled: !!displayUser && activeTab === 'anime_list' && !isPrivate,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    const {
        data: reviewsData,
        fetchNextPage: fetchNextReviews,
        hasNextPage: hasNextReviews,
        isFetchingNextPage: isFetchingNextReviews,
        isLoading: reviewsLoading
    } = useInfiniteQuery({
        queryKey: ['reviews', targetUsername],
        queryFn: ({ pageParam = 1 }) =>
            reviewApi.getAll({ mine: !isPublicView, user: targetUsername, page: pageParam }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!displayUser && activeTab === 'reviews' && !isPrivate,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    useEffect(() => {
        if (displayUser?.username) {
            document.title = `${displayUser.username}'s Profile - AniShows`;
            setUserContext(displayUser);
        }
    }, [displayUser]);

    const { colors: extractedColors } = useColorExtraction(displayUser?.banner);

    useEffect(() => {
        if (extractedColors) {
            const root = document.documentElement;
            root.style.setProperty('--profile-accent', extractedColors.primary);
            root.style.setProperty('--profile-accent-light', extractedColors.accent);
            root.style.setProperty('--profile-secondary', extractedColors.secondary);
        }

        return () => {
            const root = document.documentElement;
            root.style.removeProperty('--profile-accent');
            root.style.removeProperty('--profile-accent-light');
            root.style.removeProperty('--profile-secondary');
        };
    }, [extractedColors]);

    if (isPublicView && profileLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!isPublicView && !isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    if (isPublicView && (isError || (!profileLoading && !displayUser))) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center text-gray-400">
                <User className="w-16 h-16 mb-4 opacity-50" />
                <h2 className="text-xl font-semibold">User not found</h2>
                <Link to="/" className="text-accent hover:underline mt-2">Go Home</Link>
            </div>
        );
    }

    if (!displayUser) {
        return <ProfileSkeleton />;
    }

    const tabCounts = {
        favorites: displayUser?.favorites_count,
        anime: displayUser?.anime_count,
        reviews: displayUser?.reviews_count,
    };

    return (
        <ProfileErrorBoundary username={targetUsername}>
            <div className="min-h-screen pb-20">
                <ProfileHeader
                    displayUser={displayUser}
                    isPublicView={isPublicView}
                    isOwnProfile={isOwnProfile}
                    targetUsername={targetUsername}
                    onRefetchProfile={refetchProfile}
                    onOpenFollowersModal={openFollowersModal}
                />

                <ProfileStats user={displayUser} isLoading={isPublicView && profileLoading} />

                <ProfileTabs
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    counts={tabCounts}
                />

                <div className="max-w-7xl mx-auto px-4 pt-8">
                    <div className="min-h-[400px]">
                        <ProfileContent
                            activeTab={activeTab}
                            isPrivate={isPrivate}
                            isPublicView={isPublicView}
                            isOwnProfile={isOwnProfile}
                            targetUsername={targetUsername}
                            favoritesData={favoritesData}
                            favoritesLoading={favoritesLoading}
                            isFetchingNextFavorites={isFetchingNextFavorites}
                            hasNextFavorites={hasNextFavorites}
                            fetchNextFavorites={fetchNextFavorites}
                            listStatusFilter={listStatusFilter}
                            setListStatusFilter={setListStatusFilter}
                            searchQuery={searchQuery}
                            setSearchQuery={setSearchQuery}
                            viewMode={viewMode}
                            setViewMode={setViewMode}
                            currentListData={currentListData}
                            listsLoading={listsLoading}
                            reviewsData={reviewsData}
                            reviewsLoading={reviewsLoading}
                            isFetchingNextReviews={isFetchingNextReviews}
                            hasNextReviews={hasNextReviews}
                            fetchNextReviews={fetchNextReviews}
                        />
                    </div>
                </div>

                <FollowersModal
                    username={targetUsername}
                    type={followersModalType}
                    isOpen={showFollowersModal}
                    onClose={() => setShowFollowersModal(false)}
                />
            </div>
        </ProfileErrorBoundary>
    );
}

function ProfileSkeleton() {
    return (
        <div className="min-h-screen pb-20">
            <div className="relative h-48 sm:h-64 md:h-80 lg:h-96 overflow-hidden">
                <div className="w-full h-full bg-gradient-to-br from-accent/20 via-dark-200 to-dark animate-pulse" />
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-dark to-transparent" />
            </div>

            <div className="max-w-7xl mx-auto px-4 relative -mt-16 sm:-mt-20 md:-mt-24 lg:-mt-28 z-10">
                <div className="flex flex-col md:flex-row items-center md:items-end gap-4 md:gap-6">
                    <div className="relative shrink-0">
                        <div className="w-28 h-28 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-44 lg:h-44 rounded-2xl bg-dark-100 p-1.5 shadow-2xl">
                            <div className="w-full h-full rounded-xl bg-dark-200 animate-pulse" />
                        </div>
                    </div>

                    <div className="flex-1 text-center md:text-left pb-2 w-full">
                        <div className="h-8 sm:h-10 md:h-12 lg:h-14 w-48 bg-dark-200 rounded animate-pulse mb-3 mx-auto md:mx-0" />
                        <div className="h-4 w-32 bg-dark-200 rounded animate-pulse mb-4 mx-auto md:mx-0" />
                        <div className="h-4 w-64 bg-dark-200 rounded animate-pulse mx-auto md:mx-0" />
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 mt-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="bg-dark-100/50 rounded-xl p-4 border border-gray-800">
                            <div className="h-6 w-16 bg-dark-200 rounded animate-pulse mb-2" />
                            <div className="h-4 w-24 bg-dark-200 rounded animate-pulse" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
