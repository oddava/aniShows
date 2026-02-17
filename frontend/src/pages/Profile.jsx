import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { User, Heart, List, MessageSquare, Lock, BarChart3, Search, LayoutGrid, LayoutList, Clock, Star, Tv, Link as LinkIcon, ExternalLink, Award, Trophy, Zap, Sparkles, Plus, Flame, TrendingUp, Target } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi, reviewApi, authApi } from '../api/client';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import ProfileAnimeCard, { ProfileAnimeCardSkeleton } from '../components/ProfileAnimeCard';
import ReviewCard from '../components/ReviewCard';
import ProfileInsights from '../components/ProfileInsights';
import DraggableFavoritesGrid from '../components/DraggableFavoritesGrid';
import useColorExtraction from '../hooks/useColorExtraction';
import FollowButton from '../components/FollowButton';
import FollowersModal from '../components/FollowersModal';
import logger from '../utils/logger';

// Social link icons as SVG components
const TwitterIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);

const DiscordIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
);

const GitHubIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
);

const PlatformIcon = ({ platform }) => {
    const p = platform?.toLowerCase() || '';
    if (p.includes('twitter') || p === 'x') return <TwitterIcon />;
    if (p.includes('discord')) return <DiscordIcon />;
    if (p.includes('github')) return <GitHubIcon />;
    if (p.includes('youtube')) return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    );
    if (p.includes('instagram')) return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
    );
    return <LinkIcon className="w-4 h-4" />;
};

// Decode HTML entities in text
const decodeHtmlEntities = (text) => {
    if (!text) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
};

// Generate user badges based on stats
const getUserBadges = (user) => {
    const badges = [];

    if (user?.reviews_count >= 10) {
        badges.push({ icon: Star, label: 'Top Reviewer', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30' });
    }
    if (user?.anime_count >= 100) {
        badges.push({ icon: Zap, label: 'Power User', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/30' });
    }
    if (user?.anime_count >= 50) {
        badges.push({ icon: Trophy, label: 'Completionist', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' });
    }
    if (user?.is_early_adopter) {
        badges.push({ icon: Award, label: 'Early Adopter', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/30' });
    }

    return badges.slice(0, 3);
};

// Mean Score Badge with color coding
const MeanScoreBadge = ({ score }) => {
    let colorClass = 'text-gray-400';
    let bgClass = 'bg-gray-500/20';
    let borderClass = 'border-gray-500/30';
    
    if (score >= 8) {
        colorClass = 'text-emerald-400';
        bgClass = 'bg-emerald-500/20';
        borderClass = 'border-emerald-500/30';
    } else if (score >= 5) {
        colorClass = 'text-yellow-400';
        bgClass = 'bg-yellow-500/20';
        borderClass = 'border-yellow-500/30';
    } else if (score > 0) {
        colorClass = 'text-red-400';
        bgClass = 'bg-red-500/20';
        borderClass = 'border-red-500/30';
    }

    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${bgClass} ${colorClass} border ${borderClass}`}>
            <Star className="w-3.5 h-3.5 fill-current" />
            <span>{score > 0 ? score : '-'}</span>
        </div>
    );
};

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
    const queryClient = useQueryClient();

    const isPublicView = !!username && username.toLowerCase() !== currentUser?.username?.toLowerCase();
    const isOwnProfile = !isPublicView;
    const targetUsername = isPublicView ? username : currentUser?.username;

    // Fetch Public Profile Data
    const { data: publicProfile, isLoading: profileLoading, isError, refetch: refetchProfile } = useQuery({
        queryKey: ['profile', targetUsername],
        queryFn: () => authApi.getByUsername(targetUsername).then(res => res.data),
        enabled: isPublicView,
        retry: false,
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    const displayUser = isPublicView ? publicProfile : currentUser;
    const isPrivate = isPublicView && displayUser?.is_private;

    const openFollowersModal = (type) => {
        setFollowersModalType(type);
        setShowFollowersModal(true);
    };

    // Queries
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
        cacheTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    const favorites = favoritesData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    const STATUS_TABS = [
        { value: 'Watching', label: 'Watching', icon: '👀' },
        { value: 'Completed', label: 'Completed', icon: '✓' },
        { value: 'Plan to Watch', label: 'Planning', icon: '📋' },
        { value: 'On Hold', label: 'On Hold', icon: '⏸' },
        { value: 'Dropped', label: 'Dropped', icon: '✗' },
    ];

    const { data: currentListData, isLoading: listsLoading } = useQuery({
        queryKey: ['lists', targetUsername, listStatusFilter],
        queryFn: () => listApi.getAll({ status: listStatusFilter, username: targetUsername }).then(res => res.data.results || res.data || []),
        enabled: !!displayUser && activeTab === 'anime_list' && !isPrivate,
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000,
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
        cacheTime: 10 * 60 * 1000,
        refetchOnMount: false,
    });

    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    const filteredListItems = useMemo(() => {
        if (!currentListData || !searchQuery.trim()) return currentListData || [];
        const query = searchQuery.toLowerCase();
        return currentListData.filter(item =>
            item.anime?.title?.toLowerCase().includes(query) ||
            item.anime?.title_jp?.toLowerCase().includes(query)
        );
    }, [currentListData, searchQuery]);

    useEffect(() => {
        if (displayUser?.username) {
            document.title = `${displayUser.username}'s Profile - AniShows`;
        }
    }, [displayUser]);

    // Dynamic color extraction from banner - lazy/non-blocking
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

    // Only show full loading spinner for public profiles while fetching
    // For own profile, show skeleton UI instead of blocking
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

    const renderAnimeList = () => {
        if (listsLoading) {
            return (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 md:gap-3">
                    {Array(12).fill(0).map((_, i) => <ProfileAnimeCardSkeleton key={i} />)}
                </div>
            );
        }

        if (!filteredListItems || filteredListItems.length === 0) {
            return (
                <div className="text-center py-16 text-gray-400 bg-dark-100/50 rounded-xl border border-gray-800 border-dashed">
                    <p>{searchQuery ? "No anime found matching your search." : `No anime in ${listStatusFilter}.`}</p>
                    {!searchQuery && !isPublicView && (
                        <Link to="/browse" className="text-accent hover:underline mt-2 inline-block">Browse anime to add some!</Link>
                    )}
                </div>
            );
        }

        return viewMode === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 md:gap-3">
                {filteredListItems.map((item) => (
                    <ProfileAnimeCard
                        key={item.id}
                        anime={item.anime}
                        episodesWatched={item.episodes_watched}
                        showProgress={listStatusFilter === 'Watching'}
                        listEntryId={item.id}
                    />
                ))}
            </div>
        ) : (
            <div className="space-y-2">
                {filteredListItems.map((item) => (
                    <Link
                        key={item.id}
                        to={`/anime/${item.anime?.slug}`}
                        className="flex items-center gap-4 bg-dark-100 hover:bg-dark-50 rounded-lg p-3 border border-gray-800 hover:border-accent/30 transition-all group"
                    >
                        <img
                            src={item.anime?.cover_image}
                            alt={item.anime?.title}
                            className="w-12 h-16 rounded object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-white group-hover:text-accent transition-colors truncate">
                                {item.anime?.title}
                            </h4>
                            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                                <span>{item.anime?.anime_type || 'TV'}</span>
                                <span>•</span>
                                <span>{item.anime?.episode_count || '?'} eps</span>
                                {item.score > 0 && (
                                    <>
                                        <span>•</span>
                                        <span className="flex items-center gap-1 text-yellow-500">
                                            <Star className="w-3 h-3 fill-current" />
                                            {item.score}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                        {listStatusFilter === 'Watching' && item.anime?.episode_count > 0 && (
                            <div className="flex items-center gap-4 shrink-0 px-2" onClick={(e) => e.preventDefault()}>
                                <div className="hidden sm:flex flex-col items-end gap-1">
                                    <div className="w-32 h-2 bg-dark-200 rounded-full overflow-hidden border border-white/5">
                                        <div
                                            className={`h-full transition-all duration-700 ${((item.episodes_watched || 0) / item.anime.episode_count) >= 1
                                                ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                                                : 'bg-accent shadow-[0_0_8px_rgba(139,92,246,0.4)]'}`}
                                            style={{ width: `${Math.min(((item.episodes_watched || 0) / item.anime.episode_count) * 100, 100)}%` }}
                                        />
                                    </div>
                                    <span className="text-[11px] font-bold text-white tabular-nums">
                                        <span className="text-accent">{item.episodes_watched || 0}</span>
                                        <span className="mx-0.5 text-gray-500">/</span>
                                        <span>{item.anime.episode_count}</span>
                                        <span className="ml-1 text-gray-500 font-normal uppercase text-[9px]">eps</span>
                                    </span>
                                </div>

                                {isOwnProfile && (
                                    <button
                                        onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            try {
                                                await listApi.update(item.id, { episodes_watched: (item.episodes_watched || 0) + 1 });
                                                queryClient.invalidateQueries({ queryKey: ['lists', targetUsername] });
                                            } catch (err) { logger.error(err); }
                                        }}
                                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent hover:text-white transition-all border border-accent/30"
                                        title="Mark next episode"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        )}
                    </Link>
                ))}
            </div>
        );
    };

    const renderReviews = () => {
        if (reviewsLoading) {
            return (
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
            );
        }

        if (!reviews || reviews.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-20 bg-dark-100/30 rounded-3xl border border-gray-800 border-dashed">
                    <MessageSquare className="w-12 h-12 text-gray-700 mb-4" />
                    <p className="text-gray-400 text-lg font-medium">
                        {isPublicView ? "No reviews yet." : "You haven't written any reviews yet."}
                    </p>
                </div>
            );
        }

        return (
            <div className="max-w-3xl mx-auto space-y-6">
                <div className="space-y-6">
                    {reviews.map((review) => (
                        <div key={review.id} className="relative">
                            <ReviewCard review={review} showAnime={true} />
                        </div>
                    ))}
                </div>

                {hasNextReviews && (
                    <div className="text-center mt-8">
                        <button
                            onClick={() => fetchNextReviews()}
                            disabled={isFetchingNextReviews}
                            className="btn-secondary text-sm px-6 py-2"
                        >
                            {isFetchingNextReviews ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                'Load More Reviews'
                            )}
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderContent = () => {
        if (isPrivate) {
            return (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <Lock className="w-16 h-16 mb-4 opacity-50" />
                    <h3 className="text-xl font-semibold mb-2">This profile is private</h3>
                    <p>Only the user can see their lists and reviews.</p>
                </div>
            );
        }

        switch (activeTab) {
            case 'favorites':
                return (
                    <div className="space-y-8 animate-tab-content">
                        {favoritesLoading ? (
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 md:gap-3">
                                {Array(7).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                            </div>
                        ) : favorites?.length > 0 ? (
                            <DraggableFavoritesGrid
                                favorites={favorites}
                                isOwnProfile={isOwnProfile}
                                username={targetUsername}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center py-20 bg-dark-100/30 rounded-3xl border border-gray-800 border-dashed glass">
                                <Heart className="w-12 h-12 text-gray-700 mb-4" />
                                <p className="text-gray-400 text-lg font-medium">
                                    {isPublicView ? "No favorites yet." : "You haven't added any favorites yet."}
                                </p>
                                {!isPublicView && (
                                    <Link to="/browse" className="mt-6 px-6 py-2.5 bg-accent text-white rounded-xl font-bold shadow-lg shadow-accent/20 hover:scale-105 transition-transform">
                                        Browse Anime
                                    </Link>
                                )}
                            </div>
                        )}

                        {hasNextFavorites && (
                            <div className="text-center">
                                <button
                                    onClick={() => fetchNextFavorites()}
                                    disabled={isFetchingNextFavorites}
                                    className="btn-secondary text-sm px-6 py-2"
                                >
                                    {isFetchingNextFavorites ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        'Load More Favorites'
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                );

            case 'anime_list':
                return (
                    <div className="space-y-6 animate-tab-content">
                        {/* Status Tabs */}
                        <div className="flex flex-wrap gap-2">
                            {STATUS_TABS.map((tab) => (
                                <button
                                    key={tab.value}
                                    onClick={() => setListStatusFilter(tab.value)}
                                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${listStatusFilter === tab.value
                                        ? 'bg-accent text-white shadow-lg shadow-accent/20'
                                        : 'bg-dark-100 text-gray-400 hover:text-white hover:bg-dark-50 border border-gray-800'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* List Controls */}
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input
                                    type="text"
                                    placeholder={`Search in ${listStatusFilter}...`}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="input w-full pl-10 py-2 text-sm"
                                />
                            </div>

                            <div className="flex items-center gap-1 bg-dark-100 rounded-lg p-1 border border-gray-800">
                                <button
                                    onClick={() => setViewMode('grid')}
                                    className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}
                                    title="Grid view"
                                >
                                    <LayoutGrid className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}
                                    title="List view"
                                >
                                    <LayoutList className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {filteredListItems && filteredListItems.length > 0 && (
                            <div className="text-sm text-gray-500">
                                Showing {filteredListItems.length} anime in {listStatusFilter}
                            </div>
                        )}

                        {renderAnimeList()}
                    </div>
                );

            case 'reviews':
                return renderReviews();

            case 'insights':
                return <ProfileInsights username={targetUsername} isPrivate={isPrivate} />;

            default:
                return null;
        }
    };



    // Show skeleton while user data is loading
    if (!displayUser) {
        return (
            <div className="min-h-screen pb-20">
                {/* Skeleton Banner */}
                <div className="relative h-48 sm:h-64 md:h-80 lg:h-96 overflow-hidden">
                    <div className="w-full h-full bg-gradient-to-br from-accent/20 via-dark-200 to-dark animate-pulse" />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-dark to-transparent" />
                </div>
                
                {/* Skeleton Profile Header */}
                <div className="max-w-7xl mx-auto px-4 relative -mt-16 sm:-mt-20 md:-mt-24 lg:-mt-28 z-10">
                    <div className="flex flex-col md:flex-row items-center md:items-end gap-4 md:gap-6">
                        {/* Skeleton Avatar */}
                        <div className="relative shrink-0">
                            <div className="w-28 h-28 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-44 lg:h-44 rounded-2xl bg-dark-100 p-1.5 shadow-2xl">
                                <div className="w-full h-full rounded-xl bg-dark-200 animate-pulse" />
                            </div>
                        </div>
                        
                        {/* Skeleton User Info */}
                        <div className="flex-1 text-center md:text-left pb-2 w-full">
                            <div className="h-8 sm:h-10 md:h-12 lg:h-14 w-48 bg-dark-200 rounded animate-pulse mb-3 mx-auto md:mx-0" />
                            <div className="h-4 w-32 bg-dark-200 rounded animate-pulse mb-4 mx-auto md:mx-0" />
                            <div className="h-4 w-64 bg-dark-200 rounded animate-pulse mx-auto md:mx-0" />
                        </div>
                    </div>
                </div>
                
                {/* Skeleton Stats */}
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

    return (
        <div className="min-h-screen pb-20">
            {/* Hero Section with Dynamic Banner */}
            <div className="relative">
                {/* Banner Background */}
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
                    {/* Bottom fade to content */}
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-dark to-transparent" />
                </div>

                {/* Profile Header Content - Overlapping Avatar */}
                <div className="max-w-7xl mx-auto px-4 relative -mt-16 sm:-mt-20 md:-mt-24 lg:-mt-28 z-10">
                    <div className="flex flex-col md:flex-row items-center md:items-end gap-4 md:gap-6">
                        {/* Avatar - Breaking the border */}
                        <div className="relative shrink-0">
                            <div className="w-28 h-28 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-44 lg:h-44 rounded-2xl bg-dark-100 p-1.5 shadow-2xl">
                                <div className="w-full h-full rounded-xl border-2 border-white/20 overflow-hidden relative">
                                    {displayUser?.avatar ? (
                                        <img 
                                            src={displayUser.avatar} 
                                            alt={displayUser.username} 
                                            className="w-full h-full object-cover" 
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                            <User className="w-20 h-20 text-white" />
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Online status indicator */}
                            {displayUser?.is_online ? (
                                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-4 border-dark shadow-lg" title="Online" />
                            ) : (
                                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gray-500 rounded-full border-4 border-dark shadow-lg" title="Offline" />
                            )}
                        </div>

                        {/* User Info Section */}
                        <div className="flex-1 text-center md:text-left pb-2 w-full">
                            {/* Username & Badges */}
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 md:gap-3 mb-2">
                                <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight">
                                    {displayUser?.username}
                                </h1>

                            </div>

                            {/* Social Cluster - Followers/Following */}
                            <div className="flex items-center gap-4 justify-center md:justify-start mb-4">
                                <button 
                                    onClick={() => openFollowersModal('followers')}
                                    className="text-sm text-gray-400 hover:text-white transition-colors"
                                >
                                    <span className="font-bold text-white">{(displayUser?.followers_count ?? 0).toLocaleString()}</span> Followers
                                </button>
                                <span className="text-gray-600">•</span>
                                <button 
                                    onClick={() => openFollowersModal('following')}
                                    className="text-sm text-gray-400 hover:text-white transition-colors"
                                >
                                    <span className="font-bold text-white">{(displayUser?.following_count ?? 0).toLocaleString()}</span> Following
                                </button>
                            </div>

                            {/* Bio */}
                            {displayUser?.bio && (
                                <p className="text-gray-300 text-sm md:text-base max-w-2xl mb-4 leading-relaxed">
                                    {decodeHtmlEntities(displayUser.bio)}
                                </p>
                            )}

                            {/* Social Links */}
                            {displayUser?.social_links?.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2 justify-center md:justify-start">
                                    {displayUser.social_links.map((link, index) => (
                                        <a
                                            key={index}
                                            href={link.value.startsWith('http') ? link.value : `https://${link.value}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white transition-all border border-white/5 text-xs font-medium"
                                        >
                                            <PlatformIcon platform={link.platform} />
                                            <span>{link.platform}</span>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Action Row */}
                        <div className="flex items-center gap-2 md:gap-3 justify-center md:justify-end pb-2 shrink-0 w-full md:w-auto">
                            {!isPublicView ? (
                                <Link 
                                    to="/settings" 
                                    className="px-4 py-2 md:px-5 md:py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all border border-white/10 text-sm font-semibold active:scale-95 flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c.94-1.543-.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    <span className="hidden sm:inline">Edit Profile</span>
                                    <span className="sm:hidden">Edit</span>
                                </Link>
                            ) : (
                                <>
                                    <FollowButton
                                        username={targetUsername}
                                        initialIsFollowing={displayUser?.is_following}
                                        onSuccess={() => isPublicView && refetchProfile()}
                                        className="px-4 md:px-6"
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Section - Split Layout */}
            <div className="max-w-7xl mx-auto px-4 mt-10 mb-12">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Impact Widget (Left) - Anime Count & Days Watched */}
                    <div className="lg:col-span-1">
                        <div className="glass rounded-2xl p-6 h-full relative overflow-hidden group">
                            {/* Background decoration */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl group-hover:bg-accent/20 transition-all duration-500" />
                            
                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-6">
                                    <TrendingUp className="w-5 h-5 text-accent" />
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Impact</h3>
                                </div>

                                {/* Anime Count */}
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                                        <Tv className="w-6 h-6 text-accent" />
                                    </div>
                                    <div>
                                        <div className="text-3xl font-bold text-white">{displayUser?.anime_count || 0}</div>
                                        <div className="text-sm text-gray-500">Anime Watched</div>
                                    </div>
                                </div>

                                {/* Days Watched */}
                                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                                    <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                                        <Clock className="w-5 h-5 text-accent" />
                                    </div>
                                    <div>
                                        <div className="text-xl font-bold text-white">{displayUser?.days_watched || 0}</div>
                                        <div className="text-xs text-gray-500">Days Watched</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Quick-Look Grid (Right) - Points, Mean Score */}
                    <div className="lg:col-span-2">
                        <div className="glass rounded-2xl p-6 h-full">
                            <div className="flex items-center gap-2 mb-6">
                                <Target className="w-5 h-5 text-accent" />
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Quick Stats</h3>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                                {/* Points - Gamified */}
                                <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded-xl p-4 border border-yellow-500/20 hover:border-yellow-500/40 transition-all group">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                                            <Flame className="w-4 h-4 text-yellow-500" />
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium">Points</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white group-hover:text-yellow-400 transition-colors">
                                        {displayUser?.points || 0}
                                    </div>
                                    <div className="text-xs text-gray-600 mt-1">Total earned</div>
                                </div>

                                {/* Mean Score */}
                                <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-xl p-4 border border-emerald-500/20 hover:border-emerald-500/40 transition-all">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                            <Star className="w-4 h-4 text-emerald-400" />
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium">Mean Score</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <MeanScoreBadge score={displayUser?.mean_score || 0} />
                                    </div>
                                    <div className="text-xs text-gray-600 mt-2">Average rating</div>
                                </div>

                                {/* Favorites */}
                                <div className="bg-gradient-to-br from-pink-500/10 to-rose-500/10 rounded-xl p-4 border border-pink-500/20 hover:border-pink-500/40 transition-all">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                                            <Heart className="w-4 h-4 text-pink-400" />
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium">Favorites</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{displayUser?.favorites_count || 0}</div>
                                    <div className="text-xs text-gray-600 mt-1">Saved anime</div>
                                </div>

                                {/* Reviews */}
                                <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-xl p-4 border border-blue-500/20 hover:border-blue-500/40 transition-all">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                            <MessageSquare className="w-4 h-4 text-blue-400" />
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium">Reviews</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{displayUser?.reviews_count || 0}</div>
                                    <div className="text-xs text-gray-600 mt-1">Written</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="max-w-7xl mx-auto px-4 mb-8">
                <div className="flex gap-4 sm:gap-6 md:gap-8 border-b border-gray-800 overflow-x-auto scrollbar-hide">
                    {[
                        { id: 'favorites', label: 'Favorites', shortLabel: 'Favs', icon: Heart, count: displayUser?.favorites_count },
                        { id: 'anime_list', label: 'Anime List', shortLabel: 'List', icon: List, count: displayUser?.anime_count },
                        { id: 'reviews', label: 'Reviews', shortLabel: 'Reviews', icon: MessageSquare, count: displayUser?.reviews_count },
                        { id: 'insights', label: 'Insights', shortLabel: 'Stats', icon: BarChart3, count: null },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`pb-3 px-1 font-semibold text-xs sm:text-sm transition-all duration-200 whitespace-nowrap flex items-center gap-1 sm:gap-2 relative flex-shrink-0
                                ${activeTab === tab.id 
                                    ? 'text-white' 
                                    : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <tab.icon className={`w-3 h-3 sm:w-4 sm:h-4 ${activeTab === tab.id ? 'text-accent' : ''}`} />
                            <span className="hidden sm:inline">{tab.label}</span>
                            <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
                            {tab.count !== null && tab.count > 0 && (
                                <span className={`text-xs opacity-60 ${activeTab === tab.id ? 'text-accent' : ''}`}>
                                    ({tab.count})
                                </span>
                            )}
                            
                            {/* Active underline */}
                            {activeTab === tab.id && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="max-w-7xl mx-auto px-4 pt-8">
                <div className="min-h-[400px]">
                    {renderContent()}
                </div>
            </div>

            {/* Followers/Following Modal */}
            <FollowersModal
                username={targetUsername}
                type={followersModalType}
                isOpen={showFollowersModal}
                onClose={() => setShowFollowersModal(false)}
            />
        </div>
    );
}
