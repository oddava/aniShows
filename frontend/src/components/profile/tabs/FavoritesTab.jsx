// Profile "Favorites" tab body (G5 Community). Rendered by the ProfileContent shell (G1).
import React from 'react';
import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimeCardSkeleton } from '../../AnimeCard';
import DraggableFavoritesGrid from '../../DraggableFavoritesGrid';
import ProfileErrorBoundary, { ErrorVariant } from '../ProfileErrorBoundary';

export default function FavoritesContent({
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
