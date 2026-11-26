import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, reviewApi } from '../api/client';
import FollowersModal from '../components/FollowersModal';
import {
    ProfileErrorBoundary,
    ProfileHeader,
    ProfileTabs,
    ProfileContent,
} from '../components/profile';
import useUserProfile from '../hooks/useUserProfile';
import {
    DEFAULT_PROFILE_PRIMARY_COLOR,
    getProfileAccentTheme,
    normalizeProfilePrimaryColor,
} from '../utils/profileAccent';

import OverviewTab from '../components/profile/OverviewTab';
import ErrorState from '../components/common/ErrorState';
import useSwitchFade from '../hooks/useSwitchFade';
import { favoriteKeys, listQueries, profileKeys, profileQueries, reviewKeys } from '../api/queries/user';
import PageLoader from '../components/common/PageLoader';
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
            // Read below the tab bar? Then the new tab starts right under the
            // stuck bar, not mid-page; above it, nothing moves.
            const anchor = document.querySelector('[data-profile-tabs-top]');
            const barTop = anchor ? anchor.getBoundingClientRect().top + window.scrollY : null;
            navigate(nextPath, { replace });
            if (barTop != null && window.scrollY > barTop) {
                requestAnimationFrame(() => window.scrollTo({ top: barTop }));
            }
        }
    }, [targetUsername, location.pathname, navigate]);

    // Reset tab state and refetch when navigating between different profiles
    useEffect(() => {
        const previousUsername = prevTargetUsernameRef.current;
        if (previousUsername !== targetUsername) {
            prevTargetUsernameRef.current = targetUsername;
            // Same profile in its canonical case (see below): keep the tab.
            if (previousUsername && targetUsername
                && previousUsername.toLowerCase() === targetUsername.toLowerCase()) {
                return;
            }
            handleTabChange('overview', { replace: true });
            setSearchQuery('');
            setListStatusFilter('Watching');

            // When switching back to own profile, force a refetch since refetchOnMount
            // won't trigger (component doesn't unmount between /profile/:username and /profile)
            if (isOwnProfile && currentUser) {
                queryClient.invalidateQueries({ queryKey: profileKeys.own });
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

    const { data: publicProfile, isPending: profilePending, isError, error: profileError, refetch: refetchProfile } = useQuery({
        ...profileQueries.byUsername(targetUsername),
        enabled: isPublicView,
        staleTime: 30 * 1000, // 30 seconds — allow quick revisits to use cache, but refetch often
        gcTime: 10 * 60 * 1000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
    });

    // For own profile, use the centralized hook
    const { data: ownProfile } = useUserProfile();

    const displayUser = isPublicView ? publicProfile : (ownProfile || currentUser);

    // Usernames are case-insensitive: /u/someone shows "SomeOne". Once the
    // profile has loaded, swap the URL to the canonical name, keeping the tab,
    // query and hash, and seed the cache so the new key needs no refetch.
    const canonicalUsername = displayUser?.username;
    useEffect(() => {
        if (forcedUsername || pathSegments[0] !== 'u') return;
        const urlUsername = pathSegments[1];
        if (!urlUsername || !canonicalUsername) return;
        if (urlUsername === canonicalUsername) return;
        if (urlUsername.toLowerCase() !== canonicalUsername.toLowerCase()) return;

        if (isPublicView && publicProfile) {
            queryClient.setQueryData(profileKeys.byUsername(canonicalUsername), publicProfile);
        }
        const rest = pathSegments.slice(2).map((segment) => `/${segment}`).join('');
        navigate(`/u/${canonicalUsername}${rest}${location.search}${location.hash}`, { replace: true });
    }, [
        forcedUsername, pathSegments, canonicalUsername, isPublicView, publicProfile,
        queryClient, navigate, location.search, location.hash,
    ]);
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
        queryKey: favoriteKeys.byUser(targetUsername),
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
        ...listQueries.byStatus(targetUsername, listStatusFilter),
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
        queryKey: reviewKeys.byUser(targetUsername),
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
            document.title = `${displayUser.username}'s profile - AniShows`;
        }
    }, [displayUser]);

    const selectedPrimaryColor = normalizeProfilePrimaryColor(displayUser?.profile_primary_color);

    useEffect(() => {
        const root = document.documentElement;
        const { baseColor, lightColor, darkColor } = getProfileAccentTheme(
            selectedPrimaryColor || DEFAULT_PROFILE_PRIMARY_COLOR
        );

        // The profile colour decorates the profile (banner fallback, heatmap,
        // charts); controls keep the fixed system colours.
        const vars = {
            '--profile-accent': baseColor,
            '--profile-accent-light': lightColor,
            '--profile-secondary': darkColor,
        };
        Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));

        return () => {
            Object.keys(vars).forEach((name) => root.style.removeProperty(name));
        };
    }, [selectedPrimaryColor]);

    // The overview's status legend and "see all" open the list at a status.
    const openListStatus = useCallback((status) => {
        if (status) setListStatusFilter(status);
        handleTabChange('anime_list');
    }, [handleTabChange]);

    // Each tab switch fades the new tab in (opacity only).
    const tabFade = useSwitchFade(activeTab);

    // Handle loading states first
    if (isPublicView && profilePending && !isError) {
        return <ProfileSkeleton activeTab={activeTab} />;
    }

    if (!isPublicView && loading) {
        return <ProfileSkeleton activeTab={activeTab} />;
    }

    if (!isPublicView && !isAuthenticated) {
        return <><PageLoader /><Navigate to="/login" replace /></>;
    }

    if (isPublicView && isError && profileError?.response?.status !== 404) {
        return (
            <div className="page-container min-h-[60vh] flex items-center justify-center py-16">
                <ErrorState
                    className="w-full max-w-lg"
                    title="Couldn’t load this profile"
                    message="The server didn’t answer. Try again in a moment."
                    onRetry={() => refetchProfile()}
                />
            </div>
        );
    }

    if (isPublicView && (isError || !displayUser)) {
        return (
            <div className="page-container min-h-[60vh] pt-24 md:pt-32">
                <h2 className="page-title">User not found</h2>
                <p className="mt-3 text-[17px] text-[var(--text-2)]">
                    No one here goes by that name. <Link to="/" className="text-link">Back home</Link>
                </p>
            </div>
        );
    }

    if (!displayUser) {
        return <ProfileSkeleton activeTab={activeTab} />;
    }

    return (
        <ProfileErrorBoundary username={targetUsername}>
            {/* overflow-x: clip, not hidden: a hidden overflow would make this
                the tab bar's scroll container and stop it sticking. */}
            <div className="profile-page min-h-screen overflow-x-clip pb-20">
                <ProfileHeader
                    displayUser={displayUser}
                    isPublicView={isPublicView}
                    isPrivate={isPrivate}
                    targetUsername={targetUsername}
                    onOpenFollowersModal={openFollowersModal}
                />

                <ProfileTabs
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    displayUser={displayUser}
                />

                <div key={activeTab} className={`page-container mt-5 md:mt-6 ${tabFade}`}>
                    {activeTab === 'overview' ? (
                        <OverviewTab
                            displayUser={displayUser}
                            targetUsername={targetUsername}
                            isPrivate={isPrivate}
                            onTabChange={handleTabChange}
                            onOpenListStatus={openListStatus}
                            isOwnProfile={isOwnProfile}
                            viewerSignedIn={isAuthenticated}
                        />
                    ) : (
                        <ProfileContent
                            activeTab={activeTab}
                            isPrivate={isPrivate}
                            isPublicView={isPublicView}
                            isOwnProfile={isOwnProfile}
                            targetUsername={targetUsername}
                            displayUser={displayUser}
                            profileLoading={isPublicView && profilePending}
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

function ProfileSkeleton({ activeTab = 'overview' }) {
    const bar = 'rounded bg-[var(--ink-2)] animate-pulse';

    return (
        <div className="profile-page min-h-screen overflow-x-clip pb-20" aria-hidden="true">
            <div className="profile-hero__banner w-full bg-[var(--ink-1)] animate-pulse" />
            <div className="page-container">
                <div className="profile-hero__identity flex items-end gap-4 sm:gap-6">
                    <div className="h-[6.5rem] w-[6.5rem] shrink-0 rounded-full border-4 border-[var(--ink-0)] bg-[var(--ink-2)] sm:h-[9.5rem] sm:w-[9.5rem] lg:h-[10.5rem] lg:w-[10.5rem]" />
                    <div className="min-w-0 flex-1 pb-3">
                        <div className={`h-9 w-56 max-w-full ${bar}`} />
                        <div className={`mt-3 h-4 w-32 ${bar}`} />
                    </div>
                </div>
                <div className={`mt-5 h-9 w-72 max-w-full rounded-2xl ${bar}`} />
                <div className={`mt-4 h-4 w-48 ${bar}`} />
            </div>

            <div className="page-container mt-8">
                <div className="flex gap-2 py-2">
                    {['w-24', 'w-28', 'w-24', 'w-20', 'w-20'].map((width, index) => (
                        <div key={index} className={`h-10 ${width} rounded-lg bg-[var(--ink-1)] animate-pulse`} />
                    ))}
                </div>
            </div>

            <div className="page-container mt-5">
                {activeTab === 'overview' ? (
                    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
                        <div className="space-y-5">
                            <div className="profile-card h-[9.5rem] animate-pulse" />
                            <div className="profile-card h-72 animate-pulse" />
                        </div>
                        <div className="space-y-5">
                            <div className="profile-card h-48 animate-pulse" />
                            <div className="profile-card h-64 animate-pulse" />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 md:gap-4 lg:grid-cols-6 xl:grid-cols-7">
                        {Array.from({ length: 14 }, (_, index) => (
                            <div key={index} className="aspect-[2/3] rounded-[var(--radius-md)] bg-[var(--ink-2)] animate-pulse" />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
