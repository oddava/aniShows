import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { User } from 'lucide-react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi, reviewApi, authApi } from '../api/client';
import FollowersModal from '../components/FollowersModal';
import {
    ProfileErrorBoundary,
    ProfileHeader,
    ProfileStats,
    ProfileTabs,
    ProfileContent,
} from '../components/profile';
import useUserProfile from '../hooks/useUserProfile';
import { setUserContext } from '../sentry';
import {
    DEFAULT_PROFILE_PRIMARY_COLOR,
    getProfileAccentTheme,
    normalizeProfilePrimaryColor,
} from '../utils/profileAccent';

import MarkdownRenderer from '../components/common/MarkdownRenderer';
import OverviewTab from '../components/profile/OverviewTab';
const PROFILE_TABS = new Set(['overview', 'anime_list', 'friends', 'favorites', 'reviews', 'activity', 'insights']);

function normalizeProfileTab(tab) {
    const normalized = String(tab || '').trim().toLowerCase().replace(/-/g, '_');
    if (!normalized) return 'overview';
    if (normalized === 'animelist') return 'anime_list';
    if (normalized === 'stats') return 'insights';
    return PROFILE_TABS.has(normalized) ? normalized : 'overview';
}

function isTabSegment(segment) {
    if (!segment) return false;
    const normalized = String(segment).trim().toLowerCase().replace(/-/g, '_');
    return normalized === 'animelist' || normalized === 'stats' || PROFILE_TABS.has(normalized);
}

export default function Profile({ forcedUsername }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user: currentUser, isAuthenticated, loading } = useAuth();
    const queryClient = useQueryClient();
    const [viewMode, setViewMode] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [listStatusFilter, setListStatusFilter] = useState('Watching');
    const [showFollowersModal, setShowFollowersModal] = useState(false);
    const [followersModalType, setFollowersModalType] = useState('followers');

    const pathSegments = useMemo(
        () => location.pathname.split('/').filter(Boolean),
        [location.pathname]
    );

    const { username, activeTab } = useMemo(() => {
        if (forcedUsername) {
            const forcedTab = isTabSegment(pathSegments[1]) ? normalizeProfileTab(pathSegments[1]) : 'overview';
            return { username: forcedUsername, activeTab: forcedTab };
        }

        if (pathSegments[0] === 'u') {
            const publicUsername = pathSegments[1];
            const tabSegment = pathSegments[2];
            return {
                username: publicUsername,
                activeTab: isTabSegment(tabSegment) ? normalizeProfileTab(tabSegment) : 'overview',
            };
        }

        if (pathSegments[0] !== 'profile') {
            return { username: undefined, activeTab: 'overview' };
        }

        const first = pathSegments[1];
        const second = pathSegments[2];

        if (!first) {
            return { username: undefined, activeTab: 'overview' };
        }

        if (isTabSegment(first)) {
            return { username: undefined, activeTab: normalizeProfileTab(first) };
        }

        return {
            username: first,
            activeTab: isTabSegment(second) ? normalizeProfileTab(second) : 'overview',
        };
    }, [forcedUsername, pathSegments]);

    const isPublicView = !!username && username.toLowerCase() !== currentUser?.username?.toLowerCase();
    const isOwnProfile = !isPublicView;
    const targetUsername = isPublicView ? username : currentUser?.username;

    // Track previous targetUsername to detect profile navigation changes
    const prevTargetUsernameRef = useRef(targetUsername);

    const handleTabChange = useCallback((nextTab, options = {}) => {
        const normalizedTab = normalizeProfileTab(nextTab);
        const { replace = false } = options;
        const basePath = targetUsername ? `/u/${targetUsername}` : '/profile';
        const nextPath = normalizedTab === 'overview' ? basePath : `${basePath}/${normalizedTab}`;

        if (nextPath !== location.pathname) {
            navigate(nextPath, { replace });
        }
    }, [targetUsername, location.pathname, navigate]);

    // Reset tab state and refetch when navigating between different profiles
    useEffect(() => {
        if (prevTargetUsernameRef.current !== targetUsername) {
            handleTabChange('overview', { replace: true });
            setSearchQuery('');
            setListStatusFilter('Watching');
            prevTargetUsernameRef.current = targetUsername;

            // When switching back to own profile, force a refetch since refetchOnMount
            // won't trigger (component doesn't unmount between /profile/:username and /profile)
            if (isOwnProfile && currentUser) {
                queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            }
        }
    }, [targetUsername, isOwnProfile, currentUser, queryClient, handleTabChange]);

    // Backward compatibility: redirect legacy /profile/:username[/tab] to /u/:username[/tab]
    useEffect(() => {
        if (forcedUsername) return;
        if (pathSegments[0] !== 'profile') return;

        const candidateUsername = pathSegments[1];
        if (!candidateUsername || isTabSegment(candidateUsername)) return;

        const legacyTab = isTabSegment(pathSegments[2]) ? normalizeProfileTab(pathSegments[2]) : 'overview';
        const nextPath = legacyTab === 'overview'
            ? `/u/${candidateUsername}`
            : `/u/${candidateUsername}/${legacyTab}`;

        if (location.pathname !== nextPath) {
            navigate(nextPath, { replace: true });
        }
    }, [forcedUsername, pathSegments, location.pathname, navigate]);

    // Canonicalize own profile paths: /profile[/tab] -> /u/:currentUsername[/tab]
    useEffect(() => {
        if (forcedUsername) return;
        if (pathSegments[0] !== 'profile') return;
        if (loading || !currentUser?.username) return;

        const maybeTab = pathSegments[1];
        if (maybeTab && !isTabSegment(maybeTab)) return;

        const ownTab = isTabSegment(maybeTab) ? normalizeProfileTab(maybeTab) : 'overview';
        const nextPath = ownTab === 'overview'
            ? `/u/${currentUser.username}`
            : `/u/${currentUser.username}/${ownTab}`;

        if (location.pathname !== nextPath) {
            navigate(nextPath, { replace: true });
        }
    }, [forcedUsername, pathSegments, loading, currentUser?.username, location.pathname, navigate]);

    const { data: publicProfile, isLoading: profileLoading, isError } = useQuery({
        queryKey: ['profile', targetUsername],
        queryFn: () => authApi.getByUsername(targetUsername).then(res => res.data),
        enabled: isPublicView,
        retry: 2,
        staleTime: 30 * 1000, // 30 seconds — allow quick revisits to use cache, but refetch often
        gcTime: 10 * 60 * 1000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
    });

    // For own profile, use the centralized hook
    const { data: ownProfile, isLoading: ownProfileLoading } = useUserProfile();

    const displayUser = isPublicView ? publicProfile : (ownProfile || currentUser);
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
        queryFn: ({ pageParam }) =>
            favoriteApi.getAll({ username: targetUsername, page: pageParam }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage && lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!displayUser && activeTab === 'favorites' && !isPrivate,
        staleTime: 60 * 1000, // 1 minute
        gcTime: 10 * 60 * 1000,
        refetchOnMount: true,
    });

    const { data: currentListData, isLoading: listsLoading, isFetching: listsFetching } = useQuery({
        queryKey: ['lists', targetUsername, listStatusFilter],
        queryFn: () => listApi.getAll({ status: listStatusFilter, username: targetUsername }).then(res => res.data.results || res.data || []),
        enabled: !!displayUser && activeTab === 'anime_list' && !isPrivate,
        placeholderData: keepPreviousData,
        staleTime: 60 * 1000, // 1 minute
        gcTime: 10 * 60 * 1000,
        refetchOnMount: true,
    });

    const {
        data: reviewsData,
        fetchNextPage: fetchNextReviews,
        hasNextPage: hasNextReviews,
        isFetchingNextPage: isFetchingNextReviews,
        isLoading: reviewsLoading
    } = useInfiniteQuery({
        queryKey: ['reviews', targetUsername],
        queryFn: ({ pageParam }) =>
            reviewApi.getAll({ mine: !isPublicView, user: targetUsername, page: pageParam }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage && lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!displayUser && activeTab === 'reviews' && !isPrivate,
        staleTime: 60 * 1000, // 1 minute
        gcTime: 10 * 60 * 1000,
        refetchOnMount: true,
    });

    useEffect(() => {
        if (displayUser?.username) {
            document.title = `${displayUser.username}'s Profile - AniShows`;
            setUserContext(displayUser);
        }
    }, [displayUser]);

    const selectedPrimaryColor = normalizeProfilePrimaryColor(displayUser?.profile_primary_color);

    useEffect(() => {
        const root = document.documentElement;
        const { baseColor, lightColor, darkColor } = getProfileAccentTheme(
            selectedPrimaryColor || DEFAULT_PROFILE_PRIMARY_COLOR
        );

        root.style.setProperty('--color-accent', baseColor);
        root.style.setProperty('--color-accent-light', lightColor);
        root.style.setProperty('--color-accent-dark', darkColor);
        root.style.setProperty('--color-accent-text', baseColor);
        root.style.setProperty('--color-accent-text-hover', lightColor);

        root.style.setProperty('--profile-accent', baseColor);
        root.style.setProperty('--profile-accent-light', lightColor);
        root.style.setProperty('--profile-secondary', darkColor);

        return () => {
            const root = document.documentElement;
            root.style.removeProperty('--color-accent');
            root.style.removeProperty('--color-accent-light');
            root.style.removeProperty('--color-accent-dark');
            root.style.removeProperty('--color-accent-text');
            root.style.removeProperty('--color-accent-text-hover');
            root.style.removeProperty('--profile-accent');
            root.style.removeProperty('--profile-accent-light');
            root.style.removeProperty('--profile-secondary');
        };
    }, [selectedPrimaryColor]);

    // Handle loading states first
    if (isPublicView && profileLoading) {
        return <ProfileSkeleton />;
    }

    if (!isPublicView && loading) {
        return <ProfileSkeleton />;
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
                    targetUsername={targetUsername}
                    onOpenFollowersModal={openFollowersModal}
                />

                <ProfileTabs
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    counts={tabCounts}
                />

                <div className="max-w-7xl mx-auto px-4 mt-8">
                    {activeTab === 'overview' ? (
                        <OverviewTab
                            displayUser={displayUser}
                            targetUsername={targetUsername}
                            isPrivate={isPrivate}
                            onTabChange={handleTabChange}
                        />
                    ) : (
                        <ProfileContent
                            activeTab={activeTab}
                            isPrivate={isPrivate}
                            isPublicView={isPublicView}
                            isOwnProfile={isOwnProfile}
                            targetUsername={targetUsername}
                            displayUser={displayUser}
                            profileLoading={profileLoading}
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
                            listsFetching={listsFetching}
                            reviewsData={reviewsData}
                            reviewsLoading={reviewsLoading}
                            isFetchingNextReviews={isFetchingNextReviews}
                            hasNextReviews={hasNextReviews}
                            fetchNextReviews={fetchNextReviews}
                        />
                    )}
                </div>

                <FollowersModal
                    username={targetUsername}
                    type={followersModalType}
                    followersCount={displayUser?.followers_count ?? 0}
                    followingCount={displayUser?.following_count ?? 0}
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
            <div className="relative w-full aspect-[2.2/1] sm:aspect-[3.5/1] xl:aspect-[4.5/1] 2xl:aspect-[5.5/1] overflow-hidden">
                <div className="w-full h-full bg-dark-50 animate-pulse" />
                <div className="absolute inset-x-0 bottom-0 h-32 bg-transparent" />
            </div>

            <div className="max-w-7xl mx-auto px-4 relative z-10">
                <div className="flex flex-col md:flex-row items-center md:items-start gap-5 md:gap-8 px-2 sm:px-4 pt-4">
                    <div className="relative shrink-0 -mt-16 sm:-mt-20 md:-mt-24">
                        <div className="w-28 h-28 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-44 lg:h-44 rounded-2xl bg-dark-100 p-1.5 ">
                            <div className="w-full h-full rounded-[14px] bg-dark-200 animate-pulse" />
                        </div>
                    </div>

                    <div className="flex-1 text-center md:text-left w-full mt-2">
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
