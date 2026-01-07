import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { User, Heart, List, MessageSquare, Lock, BarChart3, Search, LayoutGrid, LayoutList, Clock, Star, Tv, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi, reviewApi, authApi } from '../api/client';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import ReviewCard from '../components/ReviewCard';
import ProfileInsights from '../components/ProfileInsights';

// Social link icons as SVG components
const TwitterIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);

const DiscordIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
);

const GitHubIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
);

const PlatformIcon = ({ platform }) => {
    const p = platform?.toLowerCase() || '';
    if (p.includes('twitter') || p === 'x') return <TwitterIcon />;
    if (p.includes('discord')) return <DiscordIcon />;
    if (p.includes('github')) return <GitHubIcon />;
    if (p.includes('youtube')) return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    );
    if (p.includes('instagram')) return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
    );
    return <LinkIcon className="w-4 h-4" />;
};

export default function Profile({ forcedUsername }) {
    const { username: paramsUsername } = useParams();
    const username = forcedUsername || paramsUsername;
    const { user: currentUser, isAuthenticated, loading } = useAuth();
    const [activeTab, setActiveTab] = useState('favorites');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [searchQuery, setSearchQuery] = useState('');

    const isPublicView = !!username && username.toLowerCase() !== currentUser?.username?.toLowerCase();
    const isOwnProfile = !isPublicView;
    const targetUsername = isPublicView ? username : currentUser?.username;

    // Fetch Public Profile Data
    const { data: publicProfile, isLoading: profileLoading, isError } = useQuery({
        queryKey: ['profile', targetUsername],
        queryFn: () => authApi.getByUsername(targetUsername).then(res => res.data),
        enabled: isPublicView,
        retry: false
    });

    const displayUser = isPublicView ? publicProfile : currentUser;
    const isPrivate = isPublicView && displayUser?.is_private;

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
        refetchOnMount: 'always',
    });

    const favorites = favoritesData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];



    const { data: allLists, isLoading: listsLoading } = useQuery({
        queryKey: ['lists', targetUsername],
        queryFn: async () => {
            const statuses = ['Watching', 'Completed', 'Plan to Watch', 'On Hold', 'Dropped'];
            const results = await Promise.all(
                statuses.map(status =>
                    listApi.getAll({ status, username: targetUsername }).then(res => ({ status, items: res.data.results || res.data }))
                )
            );
            return results;
        },
        enabled: !!displayUser && activeTab === 'anime_list' && !isPrivate,
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
    });

    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    // Filter lists by search query
    const filteredLists = useMemo(() => {
        if (!allLists || !searchQuery.trim()) return allLists;
        const query = searchQuery.toLowerCase();
        return allLists.map(group => ({
            ...group,
            items: group.items.filter(item =>
                item.anime?.title?.toLowerCase().includes(query) ||
                item.anime?.title_jp?.toLowerCase().includes(query)
            )
        }));
    }, [allLists, searchQuery]);

    useEffect(() => {
        if (displayUser?.username) {
            document.title = `${displayUser.username}'s Profile - AniShows`;
        }
    }, [displayUser]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Auth check for own profile
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
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                    {Array(10).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                </div>
            );
        }

        const listsToRender = filteredLists || allLists;
        const hasAnyItems = listsToRender?.some(group => group.items.length > 0);

        if (!hasAnyItems) {
            return (
                <div className="text-center py-16 text-gray-400">
                    <p>{searchQuery ? "No anime found matching your search." : (isPublicView ? "This user's list is empty." : "Your list is empty.")}</p>
                </div>
            );
        }

        return (
            <div className="space-y-12">
                {listsToRender.map((group) => (
                    group.items.length > 0 && (
                        <div key={group.status}>
                            <h3 className="text-xl font-bold text-white mb-4 pl-2 border-l-4 border-accent">
                                {group.status} <span className="text-gray-500 text-sm ml-2">({group.items.length})</span>
                            </h3>
                            {viewMode === 'grid' ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                                    {group.items.map((item) => (
                                        <AnimeCard
                                            key={item.id}
                                            anime={item.anime}
                                            userListEntry={item}
                                            isOwnProfile={isOwnProfile}
                                            showProgress={group.status === 'Watching'}
                                            disableEffects={true}
                                            lite={true}
                                        />
                                    ))}
                                </div>
                            ) : (
                                // List View
                                <div className="space-y-2">
                                    {group.items.map((item) => (
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
                                            {group.status === 'Watching' && item.anime?.episode_count > 0 && (
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-accent rounded-full"
                                                            style={{ width: `${((item.episodes_watched || 0) / item.anime.episode_count) * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-gray-400 tabular-nums">
                                                        {item.episodes_watched || 0}/{item.anime.episode_count}
                                                    </span>
                                                </div>
                                            )}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
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
                <div className="text-center py-16 text-gray-400 bg-dark-100 rounded-xl border border-gray-800 border-dashed">
                    <p className="mb-2">{isPublicView ? "No reviews yet." : "You haven't written any reviews yet."}</p>
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
                    <div className="space-y-8">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                            {favoritesLoading ? (
                                Array(6).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)
                            ) : favorites?.length > 0 ? (
                                favorites.map((fav) => <AnimeCard key={fav.id} anime={fav.anime} isOwnProfile={isOwnProfile} lite={true} />)
                            ) : (
                                <p className="col-span-full text-center text-gray-400 py-12">
                                    {isPublicView ? "No favorites yet." : "No favorites yet. Start adding some!"}
                                </p>
                            )}
                        </div>

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
                    <div className="space-y-6">
                        {/* List Controls */}
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                            {/* Search */}
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input
                                    type="text"
                                    placeholder="Search your list..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="input w-full pl-10 py-2 text-sm"
                                />
                            </div>

                            {/* View Toggle */}
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

    // Social links - check if any exist and are not empty
    const hasSocialLinks = Boolean(displayUser?.twitter_url || displayUser?.discord_username || displayUser?.github_url);

    return (
        <div className="min-h-screen pb-20">
            {/* Banner Section */}
            <div className="relative h-48 md:h-64 bg-dark-100">
                {displayUser?.banner ? (
                    <img src={displayUser.banner} alt="Banner" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-gradient-to-r from-gray-900 to-gray-800" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-dark-200 to-transparent" />
            </div>

            <div className="max-w-7xl mx-auto px-4 relative -mt-20">
                {/* Profile Header Card */}
                <div className="flex flex-col items-center md:flex-row md:items-end gap-4 md:gap-6 mb-8">
                    {/* Avatar */}
                    <div className="w-28 h-28 md:w-40 md:h-40 rounded-full border-4 border-dark-200 bg-dark-100 overflow-hidden shadow-xl shrink-0">
                        {displayUser?.avatar ? (
                            <img src={displayUser.avatar} alt={displayUser.username} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center">
                                <User className="w-12 h-12 md:w-16 md:h-16 text-white" />
                            </div>
                        )}
                    </div>

                    {/* User Info */}
                    <div className="flex-1 text-center md:text-left mb-2 md:mb-0">
                        <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">{displayUser?.username}</h1>
                        {!isPublicView && <p className="text-gray-400 text-sm md:text-base mb-2">{displayUser?.email}</p>}

                        {/* Bio */}
                        {displayUser?.bio && (
                            <p className="text-gray-300 text-sm md:text-base max-w-2xl bg-dark-100/50 p-3 rounded-lg backdrop-blur-sm border border-white/5 mx-auto md:mx-0 mb-3">
                                {displayUser.bio}
                            </p>
                        )}

                        {/* Social Links */}
                        {displayUser?.social_links?.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 justify-center md:justify-start mb-3">
                                {displayUser.social_links.map((link, index) => (
                                    <a
                                        key={index}
                                        href={link.value.startsWith('http') ? link.value : `https://${link.value}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-dark-100/80 hover:bg-dark-50 rounded-lg text-gray-300 hover:text-white transition-all border border-white/5 hover:border-white/10 text-xs font-medium group"
                                        title={`${link.platform}: ${link.value}`}
                                    >
                                        <PlatformIcon platform={link.platform} />
                                        <span>{link.platform}</span>
                                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </a>
                                ))}
                            </div>
                        )}

                        {/* Edit Profile Button - Owner Only */}
                        {!isPublicView && (
                            <Link to="/settings" className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-dark-100 hover:bg-dark-50 text-white rounded-lg transition-colors border border-gray-700 text-sm font-medium">
                                Edit Profile
                            </Link>
                        )}
                    </div>

                    {/* Stats */}
                    <div className="flex flex-wrap gap-4 md:gap-6 pb-2 md:pb-4 justify-center md:justify-end">
                        <div className="text-center px-3">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.anime_count || 0}</div>
                            <div className="text-xs text-gray-400 flex items-center gap-1 justify-center">
                                <Tv className="w-3 h-3" />
                                Anime
                            </div>
                        </div>
                        <div className="text-center px-3">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.days_watched || 0}</div>
                            <div className="text-xs text-gray-400 flex items-center gap-1 justify-center">
                                <Clock className="w-3 h-3" />
                                Days
                            </div>
                        </div>
                        <div className="text-center px-3">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.mean_score || '-'}</div>
                            <div className="text-xs text-gray-400 flex items-center gap-1 justify-center">
                                <Star className="w-3 h-3" />
                                Avg Score
                            </div>
                        </div>
                        <div className="text-center px-3">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.favorites_count || 0}</div>
                            <div className="text-xs text-gray-400 flex items-center gap-1 justify-center">
                                <Heart className="w-3 h-3" />
                                Favorites
                            </div>
                        </div>
                        <div className="text-center px-3">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.reviews_count || 0}</div>
                            <div className="text-xs text-gray-400 flex items-center gap-1 justify-center">
                                <MessageSquare className="w-3 h-3" />
                                Reviews
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-800 mb-8">
                    <div className="flex gap-4 md:gap-8 overflow-x-auto scrollbar-hide justify-center md:justify-start">
                        <button
                            onClick={() => setActiveTab('favorites')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'favorites' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            <span className="flex items-center gap-2">
                                <Heart className="w-4 h-4" />
                                Favorites
                            </span>
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'favorites' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('anime_list')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'anime_list' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            <span className="flex items-center gap-2">
                                <List className="w-4 h-4" />
                                Anime List
                            </span>
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'anime_list' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('reviews')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'reviews' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            <span className="flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" />
                                Reviews
                            </span>
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'reviews' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('insights')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'insights' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            <span className="flex items-center gap-2">
                                <BarChart3 className="w-4 h-4" />
                                Insights
                            </span>
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'insights' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="min-h-[400px] animate-fade-in">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}
