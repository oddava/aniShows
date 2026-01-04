import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { User, Heart, List, MessageSquare, Lock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi, reviewApi, authApi } from '../api/client';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import ReviewCard from '../components/ReviewCard';

export default function Profile({ forcedUsername }) {
    const { username: paramsUsername } = useParams();
    const username = forcedUsername || paramsUsername;
    const { user: currentUser, isAuthenticated, loading } = useAuth();
    const [activeTab, setActiveTab] = useState('favorites');

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
                } catch (e) { return undefined; }
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
                } catch (e) { return undefined; }
            }
            return undefined;
        },
        enabled: !!displayUser && activeTab === 'reviews' && !isPrivate,
    });

    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

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

        const hasAnyItems = allLists?.some(group => group.items.length > 0);

        if (!hasAnyItems) {
            return (
                <div className="text-center py-16 text-gray-400">
                    <p>{isPublicView ? "This user's list is empty." : "Your list is empty."}</p>
                </div>
            );
        }

        return (
            <div className="space-y-12">
                {allLists.map((group) => (
                    group.items.length > 0 && (
                        <div key={group.status}>
                            <h3 className="text-xl font-bold text-white mb-4 pl-2 border-l-4 border-accent">
                                {group.status} <span className="text-gray-500 text-sm ml-2">({group.items.length})</span>
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                                {group.items.map((item) => (
                                    <AnimeCard key={item.id} anime={item.anime} userListEntry={item} isOwnProfile={isOwnProfile} />
                                ))}
                            </div>
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
                                favorites.map((fav) => <AnimeCard key={fav.id} anime={fav.anime} isOwnProfile={isOwnProfile} />)
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
                return renderAnimeList();

            case 'reviews':
                return renderReviews();

            default:
                return null;
        }
    };

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
                        {!isPublicView && <p className="text-gray-400 text-sm md:text-base mb-3">{displayUser?.email}</p>}
                        {displayUser?.bio && (
                            <p className="text-gray-300 text-sm md:text-base max-w-2xl bg-dark-100/50 p-3 rounded-lg backdrop-blur-sm border border-white/5 mx-auto md:mx-0">
                                {displayUser.bio}
                            </p>
                        )}
                        {/* Edit Profile Button - Owner Only */}
                        {!isPublicView && (
                            <Link to="/settings" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-dark-100 hover:bg-dark-50 text-white rounded-lg transition-colors border border-gray-700 text-sm font-medium">
                                Edit Profile
                            </Link>
                        )}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-8 md:gap-6 pb-2 md:pb-4">
                        <div className="text-center">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.favorites_count || 0}</div>
                            <div className="text-xs md:text-sm text-gray-400">Favorites</div>
                        </div>
                        <div className="text-center">
                            <div className="text-xl md:text-2xl font-bold text-white">{displayUser?.reviews_count || 0}</div>
                            <div className="text-xs md:text-sm text-gray-400">Reviews</div>
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
                            Favorites
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'favorites' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('anime_list')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'anime_list' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Anime List
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'anime_list' ? 'scale-x-100' : 'scale-x-0'}`} />
                        </button>
                        <button
                            onClick={() => setActiveTab('reviews')}
                            className={`pb-4 px-2 font-medium transition-all duration-200 relative whitespace-nowrap
                                ${activeTab === 'reviews' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                        >
                            Reviews
                            <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left ${activeTab === 'reviews' ? 'scale-x-100' : 'scale-x-0'}`} />
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
