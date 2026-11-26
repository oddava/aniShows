// Profile "Anime list" tab body (G3 Lists). Rendered by the ProfileContent shell (G1).
// The tab owns its list query: every page of one status, searched and sorted on the server.
import React, { useEffect, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search, LayoutGrid, LayoutList } from 'lucide-react';
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
import { LIST_STATUSES, statusLabel } from '../../../utils/listStatus';
import useScrollFade from '../../../hooks/useScrollFade';
import useActivePill from '../../../hooks/useActivePill';

// Status tabs: labels and colours from utils/listStatus, like everywhere else.
const STATUS_TABS = LIST_STATUSES;

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
    const fadeRef = useScrollFade();
    const statusPill = useActivePill();
    const viewPill = useActivePill();
    const currentLabel = statusLabel(listStatusFilter);
    // As many placeholders as the tab holds (its tab count), up to 14, so a
    // short list does not flash a full grid that then collapses.
    const tabCount = search ? undefined : summary?.counts?.[listStatusFilter];
    const skeletonCount = Number.isFinite(tabCount) ? Math.min(tabCount, 14) : 14;

    return (
        <div className="space-y-6 animate-tab-content">
            <div ref={fadeRef} className="scroll-fade -mx-1 overflow-x-auto scrollbar-hide px-1">
                <div ref={statusPill.hostRef} className="pill-host flex w-max gap-2" style={{ '--pill-radius': '999px' }}>
                    <span ref={statusPill.pillRef} aria-hidden="true" className="active-pill" />
                    {STATUS_TABS.map((tab) => {
                        const isActive = listStatusFilter === tab.value;
                        const count = summary?.counts?.[tab.value];
                        // Like My list: an empty status has no tab, except
                        // Watching (where a list starts) and the one in view.
                        if (count === 0 && !isActive && tab.value !== 'Watching') return null;
                        return (
                            <button
                                key={tab.value}
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => setListStatusFilter(tab.value)}
                                className={`inline-flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-full px-4 text-[15px] transition-colors ${isActive
                                    ? 'bg-white/[0.07] text-[var(--text-1)]'
                                    : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'
                                    }`}
                            >
                                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: tab.color }} />
                                {tab.label}
                                {count != null && (
                                    <span className="text-[var(--text-3)] tabular">{count}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="relative flex-1 max-w-md w-full">
                    <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-3)]" />
                    <input
                        type="search"
                        placeholder={`Search ${currentLabel.toLowerCase()}`}
                        aria-label={`Search in ${currentLabel}`}
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
                        triggerClassName="min-h-[2.75rem] rounded-lg !border-transparent bg-white/[0.04] px-3 py-2 text-[15px] text-[var(--text-2)]"
                        menuClassName="z-[320]"
                        ariaLabel="Sort list"
                    />
                    <div ref={viewPill.hostRef} className="pill-host flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5" style={{ '--pill-bg': 'rgb(255 255 255 / 0.08)', '--pill-radius': '0.375rem' }}>
                        <span ref={viewPill.pillRef} aria-hidden="true" className="active-pill" />
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            aria-pressed={viewMode === 'grid'}
                            className={`relative flex h-9 w-10 items-center justify-center rounded-md transition-colors after:absolute after:-inset-1 after:content-[''] ${viewMode === 'grid' ? 'bg-white/[0.08] text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
                            title="Grid view"
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            aria-pressed={viewMode === 'list'}
                            className={`relative flex h-9 w-10 items-center justify-center rounded-md transition-colors after:absolute after:-inset-1 after:content-[''] ${viewMode === 'list' ? 'bg-white/[0.08] text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
                            title="List view"
                            aria-label="List view"
                        >
                            <LayoutList className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {items.length > 0 && (
                <p className="flex items-center gap-3 text-[15px] text-[var(--text-2)] tabular">
                    {totalCount} in {currentLabel}
                    {listsFetching && !listsLoading && (
                        <span className="text-sm text-[var(--text-3)]">Updating…</span>
                    )}
                </p>
            )}

            <ProfileErrorBoundary variant={ErrorVariant.SECTION} section="Anime List">
                <AnimeListView
                    listsLoading={listsLoading}
                    skeletonCount={skeletonCount}
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
                        className="btn-secondary px-5 text-[15px]"
                    >
                        {isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    );
}

function AnimeListView({
    listsLoading,
    skeletonCount = 14,
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
                {Array.from({ length: skeletonCount }, (_, i) => <AnimeCardSkeleton key={i} />)}
            </div>
        );
    }

    if (isError && items.length === 0) {
        return (
            <p className=" pt-6 text-[17px] text-[var(--text-2)]">
                Couldn’t load this list.{' '}
                <button type="button" onClick={() => onRetry()} className="text-link">Try again</button>
            </p>
        );
    }

    if (items.length === 0) {
        return (
            <p className=" pt-6 text-[17px] text-[var(--text-2)]">
                {searchQuery ? 'Nothing here matches that search.' : `Nothing in ${statusLabel(listStatusFilter)} yet.`}
                {!searchQuery && !isPublicView && (
                    <> <Link to="/browse" className="text-link">Find something to add</Link></>
                )}
            </p>
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
            </div>
        );
    }

    return (
        <div className="relative">
            <div className={`transition-opacity duration-200 ${listsFetching ? 'opacity-60' : 'opacity-100'}`}>
                {items.map((item) => (canEdit
                    ? <EditableListRow key={item.id} item={item} />
                    : <ListRow key={item.id} item={item} episodesWatched={item.episodes_watched || 0} />
                ))}
            </div>
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
                className="min-h-[2.75rem] min-w-[2.75rem] shrink-0 rounded-lg bg-white/[0.05] px-2.5 text-sm font-medium text-[var(--text-1)] transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
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
        <div className="flex items-center gap-4 py-3 ">
            <Link to={`/anime/${item.anime?.slug}`} className="flex flex-1 min-w-0 items-center gap-4">
                <img
                    src={imageUrl}
                    alt={item.anime?.title}
                    onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                    className="h-[72px] w-12 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                />
                <div className="flex-1 min-w-0">
                    <h4 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">
                        {item.anime?.title}
                    </h4>
                    <p className="mt-0.5 text-[15px] text-[var(--text-2)] tabular">
                        {item.anime?.anime_type || 'TV'} · {item.anime?.episode_count || '?'} episodes
                        {item.score > 0 && <> · scored {item.score}</>}
                    </p>
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
            <span className="shrink-0 px-2 text-sm text-[var(--text-2)] tabular">
                {episodesWatched}/?
            </span>
        );
    }

    const ratio = Math.min(episodesWatched / total, 1);
    return (
        <div className="flex flex-col items-end gap-1 shrink-0 px-2">
            <div className="hidden h-1 w-28 overflow-hidden rounded-full bg-white/[0.06] sm:block">
                <div
                    className="h-full rounded-full"
                    style={{ width: `${ratio * 100}%`, backgroundColor: ratio >= 1 ? 'var(--status-completed)' : 'var(--signature)' }}
                />
            </div>
            <span className="text-sm text-[var(--text-2)] tabular">
                {episodesWatched}/{total}
            </span>
        </div>
    );
}
