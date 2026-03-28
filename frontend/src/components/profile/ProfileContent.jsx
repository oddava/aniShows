import React, { useMemo, lazy, Suspense } from 'react';
import { Heart, List, MessageSquare, Lock, Search, LayoutGrid, LayoutList, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import AnimeCard, { AnimeCardSkeleton } from '../AnimeCard';
import ProfileAnimeCard, { ProfileAnimeCardSkeleton } from '../ProfileAnimeCard';
import ReviewCard from '../ReviewCard';
import DraggableFavoritesGrid from '../DraggableFavoritesGrid';
import ProfileStats from './ProfileStats';
import ProfileErrorBoundary, { ErrorVariant } from './ProfileErrorBoundary';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getOptimizedImageUrl,
} from '../../utils/imageUtils';
import ProfileInsights from '../ProfileInsights';
import FriendsTab from './FriendsTab';

const ActivityFeed = lazy(() => import('./ActivityFeed'));

const STATUS_TABS = [
    { value: 'Watching', label: 'Watching', icon: '👀' },
    { value: 'Completed', label: 'Completed', icon: '✓' },
    { value: 'Plan to Watch', label: 'Planning', icon: '📋' },
    { value: 'On Hold', label: 'On Hold', icon: '⏸' },
    { value: 'Dropped', label: 'Dropped', icon: '✗' },
];

export default function ProfileContent({
    activeTab,
    isPrivate,
    isPublicView,
    isOwnProfile,
    targetUsername,
    displayUser,
    profileLoading,
    favoritesData,
    favoritesLoading,
    isFetchingNextFavorites,
    hasNextFavorites,
    fetchNextFavorites,
    listStatusFilter,
    setListStatusFilter,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    currentListData,
    listsLoading,
    listsFetching,
    reviewsData,
    reviewsLoading,
    isFetchingNextReviews,
    hasNextReviews,
    fetchNextReviews,
}) {
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
        case 'overview':
            return null; // Overview is now handled directly in Profile.jsx

        case 'friends':
            return <FriendsTab username={targetUsername} isPrivate={isPrivate} />;

        case 'favorites':
            return (
                <FavoritesContent
                    favoritesData={favoritesData}
                    favoritesLoading={favoritesLoading}
                    isFetchingNextFavorites={isFetchingNextFavorites}
                    hasNextFavorites={hasNextFavorites}
                    fetchNextFavorites={fetchNextFavorites}
                    isOwnProfile={isOwnProfile}
                    targetUsername={targetUsername}
                    isPublicView={isPublicView}
                />
            );

        case 'anime_list':
            return (
                <AnimeListContent
                    listStatusFilter={listStatusFilter}
                    setListStatusFilter={setListStatusFilter}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    currentListData={currentListData}
                    listsLoading={listsLoading}
                    listsFetching={listsFetching}
                    isPublicView={isPublicView}
                />
            );

        case 'reviews':
            return (
                <ReviewsContent
                    reviewsData={reviewsData}
                    reviewsLoading={reviewsLoading}
                    isFetchingNextReviews={isFetchingNextReviews}
                    hasNextReviews={hasNextReviews}
                    fetchNextReviews={fetchNextReviews}
                    isPublicView={isPublicView}
                />
            );

        case 'activity':
            return (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Activity">
                    <Suspense fallback={<div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
                        <ActivityFeed username={targetUsername} isPrivate={isPrivate} />
                    </Suspense>
                </ProfileErrorBoundary>
            );

        case 'insights':
            return (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Insights">
                    <ProfileInsights
                        username={targetUsername}
                        isPrivate={isPrivate}
                        accentColor={displayUser?.profile_primary_color}
                    />
                </ProfileErrorBoundary>
            );

        default:
            return null;
    }
}

function FavoritesContent({
    favoritesData,
    favoritesLoading,
    isFetchingNextFavorites,
    hasNextFavorites,
    fetchNextFavorites,
    isOwnProfile,
    targetUsername,
    isPublicView,
}) {
    const favorites = favoritesData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    return (
        <div className="space-y-8 animate-tab-content">
            {favoritesLoading ? (
                <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 md:gap-4">
                    {Array(7).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                </div>
            ) : favorites?.length > 0 ? (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Favorites">
                    <DraggableFavoritesGrid
                        favorites={favorites}
                        isOwnProfile={isOwnProfile}
                        username={targetUsername}
                    />
                </ProfileErrorBoundary>
            ) : (
                <div className="ui-empty-state flex flex-col items-center justify-center py-20">
                    <Heart className="w-12 h-12 text-gray-700 mb-4" />
                    <p className="text-gray-400 text-lg font-medium">
                        {isPublicView ? "No favorites yet." : "You haven't added any favorites yet."}
                    </p>
                    {!isPublicView && (
                        <Link to="/browse" className="btn-primary mt-6 px-6 py-2.5">
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
}

function AnimeListContent({
    listStatusFilter,
    setListStatusFilter,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    currentListData,
    listsLoading,
    listsFetching,
    isPublicView,
}) {
    const filteredListItems = React.useMemo(() => {
        if (!currentListData || !searchQuery.trim()) return currentListData || [];
        const query = searchQuery.toLowerCase();
        return currentListData.filter(item =>
            item.anime?.title?.toLowerCase().includes(query) ||
            item.anime?.title_jp?.toLowerCase().includes(query)
        );
    }, [currentListData, searchQuery]);

    return (
        <div className="space-y-6 animate-tab-content">
            <div className="flex flex-wrap gap-2.5 p-1 bg-dark-100/50 rounded-xl border border-gray-800/60 w-fit">
                {STATUS_TABS.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => setListStatusFilter(tab.value)}
                        className={`px-5 py-2 rounded-lg font-bold text-sm transition-colors ${listStatusFilter === tab.value
                            ? 'bg-accent text-white'
                            : 'text-gray-500 hover:text-gray-200 hover:bg-dark-50'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

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
                        className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}
                        title="Grid view"
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}
                        title="List view"
                    >
                        <LayoutList className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {filteredListItems && filteredListItems.length > 0 && (
                <div className="flex items-center gap-3 text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">
                    {filteredListItems.length} Anime in {listStatusFilter}
                    {listsFetching && !listsLoading && (
                        <span className="inline-flex items-center gap-1.5 text-[10px] text-gray-400 opacity-60">
                            <span className="w-3 h-3 border border-gray-400/50 border-t-gray-200 rounded-full animate-spin" />
                            Updating...
                        </span>
                    )}
                </div>
            )}

            <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Anime List">
                <AnimeListView
                    listsLoading={listsLoading}
                    listsFetching={listsFetching}
                    filteredListItems={filteredListItems}
                    viewMode={viewMode}
                    listStatusFilter={listStatusFilter}
                    isPublicView={isPublicView}
                    searchQuery={searchQuery}
                />
            </ProfileErrorBoundary>
        </div>
    );
}

function AnimeListView({
    listsLoading,
    listsFetching,
    filteredListItems,
    viewMode,
    listStatusFilter,
    isPublicView,
    searchQuery,
}) {
    if (listsLoading) {
        return (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 md:gap-4">
                {Array(14).fill(0).map((_, i) => <ProfileAnimeCardSkeleton key={i} />)}
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

    if (viewMode === 'grid') {
        return (
            <div className="relative">
                <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 md:gap-4 transition-opacity duration-200 ${listsFetching ? 'opacity-60' : 'opacity-100'}`}>
                    {filteredListItems.map((item) => (
                        <ProfileAnimeCard
                            key={item.id}
                            anime={item.anime}
                            episodesWatched={item.episodes_watched}
                            showProgress={listStatusFilter === 'Watching'}
                        />
                    ))}
                </div>
                {listsFetching && (
                    <div className="pointer-events-none absolute inset-0 rounded-xl bg-dark/25 backdrop-blur-[1px]" aria-hidden="true" />
                )}
            </div>
        );
    }

    return (
        <div className="relative">
            <div className={`space-y-2 transition-opacity duration-200 ${listsFetching ? 'opacity-60' : 'opacity-100'}`}>
                {filteredListItems.map((item) => {
                    const imageUrl = getOptimizedImageUrl(item.anime, 'cover', 'small');
                    const fallbackImageUrl = getImageFallbackUrl(item.anime, 'cover');

                    return (
                        <Link
                            key={item.id}
                            to={`/anime/${item.anime?.slug}`}
                            className="flex items-center gap-4 bg-dark-100 rounded-lg p-3 border border-gray-800/60"
                        >
                            <img
                                src={imageUrl}
                                alt={item.anime?.title}
                                onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                                className="w-12 h-16 rounded object-cover shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-white truncate">
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
                                <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 px-2">
                                    <div className="w-32 h-2 bg-dark-200 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${((item.episodes_watched || 0) / item.anime.episode_count) >= 1 ? 'bg-green-500' : 'bg-accent'}`}
                                            style={{ width: `${Math.min(((item.episodes_watched || 0) / item.anime.episode_count) * 100, 100)}%` }}
                                        />
                                    </div>
                                    <span className="text-[11px] text-gray-400">
                                        {item.episodes_watched || 0}/{item.anime.episode_count}
                                    </span>
                                </div>
                            )}
                        </Link>
                    );
                })}
            </div>
            {listsFetching && (
                <div className="pointer-events-none absolute inset-0 rounded-xl bg-dark/25 backdrop-blur-[1px]" aria-hidden="true" />
            )}
        </div>
    );
}

function ReviewsContent({
    reviewsData,
    reviewsLoading,
    isFetchingNextReviews,
    hasNextReviews,
    fetchNextReviews,
    isPublicView,
}) {
    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

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
            <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Reviews">
                <div className="space-y-6">
                    {reviews.map((review) => (
                        <div key={review.id} className="relative">
                            <ReviewCard review={review} showAnime={true} />
                        </div>
                    ))}
                </div>
            </ProfileErrorBoundary>

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
}
