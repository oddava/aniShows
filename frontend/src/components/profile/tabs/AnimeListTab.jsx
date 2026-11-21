// Profile "Anime list" tab body (G3 Lists). Rendered by the ProfileContent shell (G1).
// The tab owns its list query: every page of one status, searched and sorted on the server.
import React, { useEffect, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search, LayoutGrid, LayoutList, Star } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import AnimeCard, { AnimeCardSkeleton } from '../../AnimeCard';
import CustomSelect from '../../common/CustomSelect';
import ProfileErrorBoundary, { ErrorVariant } from '../ProfileErrorBoundary';
import { useAuth } from '../../../context/AuthContext';
import useListEntryMutation from '../../../hooks/useListEntryMutation';
import { LIST_ORDERINGS, listQueries } from '../../../api/queries/lists';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getOptimizedImageUrl,
} from '../../../utils/imageUtils';

const STATUS_TABS = [
    { value: 'Watching', label: 'Watching' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Plan to Watch', label: 'Planning' },
    { value: 'On Hold', label: 'On Hold' },
    { value: 'Dropped', label: 'Dropped' },
];

const SEARCH_DEBOUNCE_MS = 300;
const LIST_STALE_TIME = 60 * 1000;

function useDebouncedValue(value, delay) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

/**
 * Whose list this is. G1's shell will pass `username`/`isOwnProfile`; until then the
 * own profile is the signed-in user and a public one is the `/u/:username` segment.
 */
function useListOwner({ username, isOwnProfile, isPublicView }) {
    const { user } = useAuth();
    const params = useParams();
    const ownProfile = isOwnProfile ?? !isPublicView;
    const resolvedUsername = username || (ownProfile ? user?.username : params.username);
    return { username: resolvedUsername, isOwnProfile: ownProfile };
}

export default function AnimeListContent({
    listStatusFilter,
    setListStatusFilter,
    searchQuery = '',
    setSearchQuery,
    viewMode,
    setViewMode,
    isPublicView,
    username: usernameProp,
    isOwnProfile: isOwnProfileProp,
}) {
    const { username, isOwnProfile } = useListOwner({
        username: usernameProp,
        isOwnProfile: isOwnProfileProp,
        isPublicView,
    });
    const [ordering, setOrdering] = useState(LIST_ORDERINGS[0].value);
    const search = useDebouncedValue(searchQuery.trim(), SEARCH_DEBOUNCE_MS);

    const { data: summary } = useQuery({
        ...listQueries.summary(username),
        enabled: !!username,
        staleTime: LIST_STALE_TIME,
    });

    const {
        data,
        isLoading: listsLoading,
        isFetching,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        isError,
        refetch,
    } = useInfiniteQuery({
        ...listQueries.paged(username, listStatusFilter, search, ordering),
        enabled: !!username,
        placeholderData: keepPreviousData,
        staleTime: LIST_STALE_TIME,
    });

    const items = React.useMemo(
        () => data?.pages?.flatMap((page) => page?.results || []) || [],
        [data],
    );
    const totalCount = data?.pages?.[0]?.count ?? items.length;
    const listsFetching = isFetching && !isFetchingNextPage;

    return (
        <div className="space-y-6 animate-tab-content">
            <div className="flex flex-wrap gap-2.5 p-1 bg-dark-100/50 rounded-xl border border-gray-800/60 w-fit">
                {STATUS_TABS.map((tab) => {
                    const isActive = listStatusFilter === tab.value;
                    const count = summary?.counts?.[tab.value];
                    return (
                        <button
                            key={tab.value}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setListStatusFilter(tab.value)}
                            className={`px-5 py-2 rounded-lg font-bold text-sm transition-colors ${isActive
                                ? 'bg-accent-dark text-white'
                                : 'text-gray-500 hover:text-gray-200 hover:bg-dark-50'
                                }`}
                        >
                            {tab.label}
                            {count != null && (
                                <span className={`ml-2 text-xs font-semibold ${isActive ? 'text-white/70' : 'text-gray-600'}`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="relative flex-1 max-w-md w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        type="search"
                        placeholder={`Search in ${listStatusFilter}...`}
                        aria-label={`Search in ${listStatusFilter}`}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input w-full pl-10 py-2 text-sm"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <CustomSelect
                        value={ordering}
                        onChange={setOrdering}
                        options={LIST_ORDERINGS}
                        triggerClassName="bg-dark-100 border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300"
                        menuClassName="z-[320]"
                        ariaLabel="Sort list"
                    />
                    <div className="flex items-center gap-1 bg-dark-100 rounded-lg p-1 border border-gray-800">
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            aria-pressed={viewMode === 'grid'}
                            className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-accent-dark text-white' : 'text-gray-400 hover:text-white'}`}
                            title="Grid view"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            aria-pressed={viewMode === 'list'}
                            className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-accent-dark text-white' : 'text-gray-400 hover:text-white'}`}
                            title="List view"
                        >
                            <LayoutList className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {items.length > 0 && (
                <div className="flex items-center gap-3 text-sm font-semibold text-gray-300">
                    {totalCount} Anime in {listStatusFilter}
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
                    isError={isError}
                    onRetry={refetch}
                    items={items}
                    viewMode={viewMode}
                    listStatusFilter={listStatusFilter}
                    isPublicView={isPublicView}
                    canEdit={isOwnProfile}
                    searchQuery={search}
                />
            </ProfileErrorBoundary>

            {hasNextPage && !isError && (
                <div className="flex justify-center pt-1">
                    <button
                        type="button"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="rounded-lg bg-dark-100 px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-dark-50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isFetchingNextPage ? 'Loading...' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    );
}

function AnimeListView({
    listsLoading,
    listsFetching,
    isError,
    onRetry,
    items,
    viewMode,
    listStatusFilter,
    isPublicView,
    canEdit,
    searchQuery,
}) {
    if (listsLoading) {
        return (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 md:gap-4">
                {Array(14).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
            </div>
        );
    }

    if (isError && items.length === 0) {
        return (
            <div className="text-center py-16 text-gray-400 bg-dark-100/50 rounded-xl border border-gray-800 border-dashed">
                <p>Failed to load this list.</p>
                <button type="button" onClick={() => onRetry()} className="text-accent hover:underline mt-2 inline-block">
                    Try again
                </button>
            </div>
        );
    }

    if (items.length === 0) {
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
                    {items.map((item) => (
                        <AnimeCard
                            key={item.id}
                            anime={item.anime}
                            userListEntry={item}
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
                {items.map((item) => (canEdit
                    ? <EditableListRow key={item.id} item={item} />
                    : <ListRow key={item.id} item={item} episodesWatched={item.episodes_watched || 0} />
                ))}
            </div>
            {listsFetching && (
                <div className="pointer-events-none absolute inset-0 rounded-xl bg-dark/25 backdrop-blur-[1px]" aria-hidden="true" />
            )}
        </div>
    );
}

/** Own-profile row: an inline +1 through the shared list hook (capped at the episode count). */
function EditableListRow({ item }) {
    const { entry, increment, isPending } = useListEntryMutation({ anime: item.anime, entry: item });
    const episodesWatched = entry?.episodes_watched ?? item.episodes_watched ?? 0;
    const total = item.anime?.episode_count || 0;
    const atEnd = total > 0 && episodesWatched >= total;

    return (
        <ListRow item={item} episodesWatched={episodesWatched}>
            <button
                type="button"
                onClick={() => increment()}
                disabled={isPending || atEnd}
                aria-label={`Add one episode to ${item.anime?.title || 'this anime'}`}
                className="shrink-0 rounded-md bg-dark-200 px-2.5 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-dark-50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
                +1
            </button>
        </ListRow>
    );
}

function ListRow({ item, episodesWatched, children }) {
    const imageUrl = getOptimizedImageUrl(item.anime, 'cover', 'small');
    const fallbackImageUrl = getImageFallbackUrl(item.anime, 'cover');

    return (
        <div className="flex items-center gap-4 bg-dark-100 rounded-lg p-3 border border-gray-800/60">
            <Link to={`/anime/${item.anime?.slug}`} className="flex flex-1 min-w-0 items-center gap-4">
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
            </Link>
            <ListProgress episodesWatched={episodesWatched} total={item.anime?.episode_count || 0} />
            {children}
        </div>
    );
}

function ListProgress({ episodesWatched, total }) {
    if (total <= 0) {
        return (
            <span className="shrink-0 px-2 text-[11px] text-gray-400">
                {episodesWatched}/? eps
            </span>
        );
    }

    const ratio = Math.min(episodesWatched / total, 1);
    return (
        <div className="flex flex-col items-end gap-1 shrink-0 px-2">
            <div className="hidden sm:block w-32 h-2 bg-dark-200 rounded-full overflow-hidden">
                <div
                    className={`h-full ${ratio >= 1 ? 'bg-green-500' : 'bg-accent-dark'}`}
                    style={{ width: `${ratio * 100}%` }}
                />
            </div>
            <span className="text-[11px] text-gray-400">
                {episodesWatched}/{total}
            </span>
        </div>
    );
}
