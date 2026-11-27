// Profile "Favorites" tab body (G5 Community). Rendered by the ProfileContent shell (G1).
import React, { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AnimeCardSkeleton } from '../../AnimeCard';
import DraggableFavoritesGrid from '../../DraggableFavoritesGrid';
import ErrorState from '../../common/ErrorState';
import ProfileErrorBoundary, { ErrorVariant } from '../ProfileErrorBoundary';
import {
    FAVORITES_REORDER_CAP,
    characterFavoriteQueries,
    favoriteKeys,
    favoriteQueries,
    staffFavoriteQueries,
} from '../../../api/queries/favorites';
import FavoritePeople, { peopleFrom } from './FavoritePeople';
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

    // Characters and voice actors, each with its own pages.
    const peopleQuery = { enabled: Boolean(targetUsername), staleTime: 60 * 1000 };
    const charactersQuery = useInfiniteQuery({ ...characterFavoriteQueries.all(targetUsername), ...peopleQuery });
    const staffQuery = useInfiniteQuery({ ...staffFavoriteQueries.all(targetUsername), ...peopleQuery });
    const peoplePending = Boolean(targetUsername) && (charactersQuery.isPending || staffQuery.isPending);

    // One kind at a time: the anime, the characters or the voice actors. A
    // kind with nothing in it is left out; one that failed to load stays so
    // its retry can be reached.
    const kinds = [
        { key: 'anime', label: 'Anime', shown: favoritesLoading || favorites.length > 0 },
        { key: 'characters', label: 'Characters', shown: peopleFrom(charactersQuery).count > 0 || charactersQuery.isError },
        { key: 'staff', label: 'Voice actors', shown: peopleFrom(staffQuery).count > 0 || staffQuery.isError },
    ].filter((kind) => kind.shown);
    const [picked, setPicked] = useState(null);
    const active = kinds.find((kind) => kind.key === picked)?.key ?? kinds[0]?.key;

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

    if (!kinds.length) {
        if (peoplePending) return <FavoritesSkeleton />;
        return (
            <p className="pt-6 text-[17px] text-[var(--text-2)] animate-tab-content">
                {isPublicView ? 'No favorites yet.' : 'No favorites yet. The heart on a show, character or voice actor puts it here.'}
                {!isPublicView && (
                    <> <Link to="/browse?sort=rating" className="text-link">See the top rated</Link></>
                )}
            </p>
        );
    }

    const showReorder = active === 'anime' && canReorder;
    const single = kinds.length === 1;

    return (
        <div className="animate-tab-content">
            {(!single || showReorder || active !== 'anime') && (
                <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-3">
                    {single ? (
                        active !== 'anime' ? <h2 className="section-title">{kinds[0].label}</h2> : <span />
                    ) : (
                        <div role="group" aria-label="Favorites" className="-ml-3.5 flex gap-1">
                            {kinds.map((kind) => (
                                <button
                                    key={kind.key}
                                    type="button"
                                    aria-pressed={active === kind.key}
                                    onClick={() => setPicked(kind.key)}
                                    className={`inline-flex min-h-11 items-center rounded-lg px-3.5 text-[15px] font-medium transition-colors duration-150
                                    ${active === kind.key
                                        ? 'bg-white/[0.07] text-[var(--text-1)]'
                                        : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`}
                                >
                                    {kind.label}
                                </button>
                            ))}
                        </div>
                    )}
                    {showReorder && (
                        <button
                            type="button"
                            onClick={() => setIsReordering(true)}
                            className="btn-secondary px-4 text-[15px]"
                        >
                            Reorder
                        </button>
                    )}
                </div>
            )}

            {active === 'anime' && (favoritesLoading ? (
                <FavoritesSkeleton />
            ) : (
                <section aria-label="Favorite anime">
                    <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Favorites">
                        <DraggableFavoritesGrid
                            favorites={favorites}
                            isOwnProfile={isOwnProfile}
                            username={targetUsername}
                        />
                    </ProfileErrorBoundary>
                    {hasNextFavorites && (
                        <button
                            type="button"
                            onClick={() => fetchNextFavorites()}
                            disabled={isFetchingNextFavorites}
                            className="btn-secondary mt-4 px-5 text-[15px]"
                        >
                            {isFetchingNextFavorites ? 'Loading…' : 'Load more'}
                        </button>
                    )}
                </section>
            ))}

            {active === 'characters' && (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Favorite characters">
                    <FavoritePeople
                        label="Favorite characters"
                        query={charactersQuery}
                        itemKey="character"
                        hrefBuilder={(character) => `/character/${character?.id}`}
                    />
                </ProfileErrorBoundary>
            )}
            {active === 'staff' && (
                <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Favorite voice actors">
                    <FavoritePeople
                        label="Favorite voice actors"
                        query={staffQuery}
                        itemKey="staff"
                        hrefBuilder={(staff) => `/staff/${staff?.id}`}
                    />
                </ProfileErrorBoundary>
            )}
        </div>
    );
}
