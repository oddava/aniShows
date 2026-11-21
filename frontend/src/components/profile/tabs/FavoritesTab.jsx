// Profile "Favorites" tab body (G5 Community). Rendered by the ProfileContent shell (G1).
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AnimeCardSkeleton } from '../../AnimeCard';
import DraggableFavoritesGrid from '../../DraggableFavoritesGrid';
import ErrorState from '../../common/ErrorState';
import ProfileErrorBoundary, { ErrorVariant } from '../ProfileErrorBoundary';
import { FAVORITES_REORDER_CAP, favoriteKeys, favoriteQueries } from '../../../api/queries/favorites';
import { miniProfileKeys } from '../../../api/queries/user';

const GRID_CLASSES = 'grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 md:gap-4';

function FavoritesSkeleton() {
    return (
        <div className={GRID_CLASSES}>
            {Array(7).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
        </div>
    );
}

/** Reorder mode: loads every favorite (up to the cap) so the saved order is complete. */
function FavoritesReorder({ username, onDone }) {
    const { data, isLoading, isError, refetch } = useQuery(favoriteQueries.allForReorder(username));

    if (isLoading) return <FavoritesSkeleton />;

    if (isError) {
        return (
            <ErrorState
                title="Couldn't load your favorites"
                message="Reordering needs your full favorites list. Check your connection and try again."
                onRetry={() => refetch()}
            >
                <button type="button" onClick={onDone} className="btn-secondary text-sm">
                    Cancel
                </button>
            </ErrorState>
        );
    }

    const favorites = data?.results || [];

    return (
        <div className="space-y-3">
            <DraggableFavoritesGrid
                favorites={favorites}
                isOwnProfile
                username={username}
                reorderMode
                onDone={onDone}
            />
            {data?.count > FAVORITES_REORDER_CAP && (
                <p className="text-center text-xs text-gray-500">
                    Only your first {FAVORITES_REORDER_CAP} favorites can be reordered here.
                </p>
            )}
        </div>
    );
}

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
    const queryClient = useQueryClient();
    const [isReordering, setIsReordering] = useState(false);

    const favorites = favoritesData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];
    const totalFavorites = favoritesData?.pages?.[0]?.count ?? favorites.length;
    const canReorder = Boolean(isOwnProfile && targetUsername) && totalFavorites > 1;

    const exitReorder = () => {
        setIsReordering(false);
        // The paginated grid (and the overview/hover-card previews) reload in the new order.
        queryClient.invalidateQueries({ queryKey: favoriteKeys.byUser(targetUsername) });
        queryClient.invalidateQueries({ queryKey: favoriteKeys.overview(targetUsername) });
        queryClient.invalidateQueries({ queryKey: miniProfileKeys.favorites(targetUsername) });
    };

    if (isReordering && canReorder) {
        return (
            <div className="space-y-8 animate-tab-content">
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Favorites">
                    <FavoritesReorder username={targetUsername} onDone={exitReorder} />
                </ProfileErrorBoundary>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-tab-content">
            {favoritesLoading ? (
                <FavoritesSkeleton />
            ) : favorites?.length > 0 ? (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Favorites">
                    {canReorder && (
                        <div className="mb-4 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setIsReordering(true)}
                                className="btn-secondary px-4 text-[15px]"
                            >
                                Reorder
                            </button>
                        </div>
                    )}
                    <DraggableFavoritesGrid
                        favorites={favorites}
                        isOwnProfile={isOwnProfile}
                        username={targetUsername}
                    />
                </ProfileErrorBoundary>
            ) : (
                <p className=" pt-6 text-[17px] text-[var(--text-2)]">
                    {isPublicView ? 'No favorites yet.' : 'No favorites yet. The heart on a show’s page puts it here.'}
                    {!isPublicView && (
                        <> <Link to="/browse?sort=rating" className="text-link">See the top rated</Link></>
                    )}
                </p>
            )}

            {hasNextFavorites && (
                <div>
                    <button
                        type="button"
                        onClick={() => fetchNextFavorites()}
                        disabled={isFetchingNextFavorites}
                        className="btn-secondary px-5 text-[15px]"
                    >
                        {isFetchingNextFavorites ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    );
}
