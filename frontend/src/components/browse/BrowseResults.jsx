import { Loader2 } from 'lucide-react';
import AnimeCard from '../AnimeCard';
import AnimeListRow from './AnimeListRow';
import AnimeMinimalCard from './AnimeMinimalCard';
import EmptyState from './EmptyState';
import { GridSkeleton, ListSkeleton, MinimalSkeleton } from '../skeletons';
import VirtualizedAnimeList from '../VirtualizedAnimeList';

/**
 * The Browse results in the chosen view mode (grid, list or minimal), with
 * the loading, empty and error states and the infinite-scroll sentinel.
 */
export default function BrowseResults({
  viewMode,
  allAnime,
  titleLanguage,
  currentSort,
  currentSearch,
  hasActiveFilters,
  clearAllFilters,
  isLoading,
  isTabSwitching,
  isError,
  isFetchingNextPage,
  refetch,
  skeletonCount,
  loadMoreRef,
}) {
  const errorState = (
    <div className="text-center py-16">
      <p className="text-red-400 mb-4">Failed to load anime</p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button onClick={() => refetch()} className="btn-primary">
          Try Again
        </button>
        <button onClick={() => window.location.reload()} className="btn-secondary">
          Reload Page
        </button>
      </div>
    </div>
  );

  // Grid View
  if (viewMode === 'grid') {
    return (
      <div>
        {isError ? (
          errorState
        ) : isLoading || isTabSwitching ? (
          <div className="skeleton-fade-in">
            <GridSkeleton count={skeletonCount} />
            <div ref={loadMoreRef} className="h-0 overflow-hidden" />
          </div>
        ) : allAnime.length === 0 ? (
          <EmptyState
            onClearFilters={clearAllFilters}
            hasActiveFilters={hasActiveFilters || currentSearch !== ''}
            searchQuery={currentSearch}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 anime-card-grid-gap">
              {allAnime.map((anime, index) => (
                  <AnimeCard
                    key={anime.id}
                    anime={anime}
                    titleLanguage={titleLanguage}
                    rank={currentSort === 'rating' ? (index + 1) : null}
                    priority={index < 6}
                    index={index}
                  />
                ))}
            </div>
            <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
              {isFetchingNextPage && (
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // List View
  if (viewMode === 'list') {
    return (
      <div className="space-y-3">
        {isError ? (
          errorState
        ) : isLoading || isTabSwitching ? (
          <div className="skeleton-fade-in">
            <ListSkeleton count={skeletonCount} />
            <div ref={loadMoreRef} className="h-0 overflow-hidden" />
          </div>
        ) : allAnime.length === 0 ? (
          <EmptyState
            onClearFilters={clearAllFilters}
            hasActiveFilters={hasActiveFilters || currentSearch !== ''}
            searchQuery={currentSearch}
          />
        ) : allAnime.length > 20 ? (
          <>
            <VirtualizedAnimeList
              items={allAnime}
              renderRow={(anime) => (
                <AnimeListRow anime={anime} titleLanguage={titleLanguage} />
              )}
              estimateSize={140}
              overscan={5}
            />
            <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
              {isFetchingNextPage && (
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
              )}
            </div>
          </>
        ) : (
          <>
            {allAnime.map((anime) => (
              <AnimeListRow key={anime.id} anime={anime} titleLanguage={titleLanguage} />
            ))}
            <div ref={loadMoreRef} className="h-10 flex justify-center items-center py-8">
              {isFetchingNextPage && (
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Minimal View
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-8 xl:grid-cols-10 gap-2">
      {isError ? (
        <div className="col-span-full">{errorState}</div>
      ) : isLoading || isTabSwitching ? (
        <div className="col-span-full grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-8 xl:grid-cols-10 gap-2 skeleton-fade-in">
          <MinimalSkeleton count={skeletonCount} />
          <div ref={loadMoreRef} className="col-span-full h-0 overflow-hidden" />
        </div>
      ) : allAnime.length === 0 ? (
        <div className="col-span-full">
          <EmptyState
            onClearFilters={clearAllFilters}
            hasActiveFilters={hasActiveFilters || currentSearch !== ''}
            searchQuery={currentSearch}
          />
        </div>
      ) : (
        <>
          {allAnime.map((anime) => (
            <AnimeMinimalCard key={anime.id} anime={anime} titleLanguage={titleLanguage} />
          ))}
          <div ref={loadMoreRef} className="col-span-full h-10 flex justify-center items-center py-8">
            {isFetchingNextPage && (
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
