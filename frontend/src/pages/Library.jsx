import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Download, LayoutGrid, Loader2, Rows3, Search, Tv } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SEO from '../components/SEO';
import AnimeCard from '../components/AnimeCard';
import LibraryRow from '../components/library/LibraryRow';
import CustomSelect from '../components/common/CustomSelect';
import EmptyState from '../components/ui/EmptyState';
import { CardSkeleton, RowSkeleton } from '../components/ui/Skeleton';
import { LIST_ORDERINGS, listQueries } from '../api/queries/lists';
import { LIST_STATUSES, normalizeStatus, statusMeta } from '../utils/listStatus';
import { progressText } from '../utils/episodes';

const ALL = 'All';

const VIEW_KEY = 'library_view';
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_SLUGS = {
    All: 'all',
    Watching: 'watching',
    Completed: 'completed',
    'Plan to Watch': 'planning',
    'On Hold': 'on-hold',
    Dropped: 'dropped',
};
const SLUG_STATUS = Object.fromEntries(Object.entries(STATUS_SLUGS).map(([value, slug]) => [slug, value]));

const EMPTY_COPY = {
    All: { title: 'Your list is empty', body: 'Add a show from any poster and it lands here, with your progress and score.' },
    Watching: { title: 'Nothing in progress', body: 'Add a show you’re watching and track it episode by episode from here or the home page.' },
    Completed: { title: 'Nothing completed yet', body: 'Finished a show? Mark it Completed and score it in one tap.' },
    'Plan to Watch': { title: 'Your plan is empty', body: 'Tap + on any poster and pick Planning to save it for later.' },
    'On Hold': { title: 'Nothing on hold', body: 'Shows you pause land here, with your place kept.' },
    Dropped: { title: 'Nothing dropped', body: 'Shows you give up on land here. No judgement.' },
};

const readView = () => {
    try {
        return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
    } catch {
        return 'grid';
    }
};

function useDebounced(value, delay) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

/**
 * Entries that leave this tab (moved to Completed, removed) stay where they
 * were, showing their new state, until the tab, search or sort changes: a
 * card never vanishes under your finger, and the score prompt after
 * Completed stays open.
 */
function useStickyEntries(fetched, viewKey) {
    const shown = useRef({ key: viewKey, list: [] });
    return useMemo(() => {
        if (shown.current.key !== viewKey) {
            shown.current = { key: viewKey, list: fetched };
            return fetched;
        }
        const fetchedIds = new Set(fetched.map((entry) => entry.id));
        const merged = [...fetched];
        shown.current.list.forEach((entry, index) => {
            if (!fetchedIds.has(entry.id)) merged.splice(Math.min(index, merged.length), 0, entry);
        });
        shown.current = { key: viewKey, list: merged };
        return merged;
    }, [fetched, viewKey]);
}

/**
 * My List (P2): the signed-in user's library at /list, opening on Watching.
 * Grid (cards with score, progress and a stepper) or a dense table with
 * inline progress, score and status. The profile stays the public page.
 */
export default function Library() {
    const { user, isAuthenticated, loading } = useAuth();
    const [params, setParams] = useSearchParams();
    const status = SLUG_STATUS[params.get('status')] || normalizeStatus(params.get('status')) || 'Watching';
    const statusFilter = status === ALL ? undefined : status;
    const [view, setView] = useState(readView);
    const [query, setQuery] = useState('');
    const [ordering, setOrdering] = useState(LIST_ORDERINGS[0].value);
    const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
    const username = user?.username;
    const sentinel = useRef(null);

    useEffect(() => {
        try {
            localStorage.setItem(VIEW_KEY, view);
        } catch {
            // Not kept; the choice still applies now.
        }
    }, [view]);

    const { data: summary } = useQuery({
        ...listQueries.summary(username),
        enabled: Boolean(username),
        staleTime: 60 * 1000,
    });

    const {
        data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData,
    } = useInfiniteQuery({
        ...listQueries.paged(username, statusFilter, search, ordering),
        enabled: Boolean(username),
        placeholderData: (previous, previousQuery) => (
            previousQuery?.queryKey?.[2] === statusFilter ? previous : undefined
        ),
        staleTime: 60 * 1000,
    });

    const fetched = useMemo(() => data?.pages?.flatMap((page) => page?.results || []) || [], [data]);
    const entries = useStickyEntries(fetched, `${status}|${search}|${ordering}`);
    const total = summary?.total ?? 0;

    useEffect(() => {
        const node = sentinel.current;
        if (!node || !hasNextPage || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver(([item]) => {
            if (item.isIntersecting && !isFetchingNextPage) fetchNextPage();
        }, { rootMargin: '400px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    if (!loading && !isAuthenticated) return <Navigate to="/login" replace state={{ from: '/list' }} />;

    const setStatus = (value) => {
        const next = new URLSearchParams(params);
        next.set('status', STATUS_SLUGS[value]);
        setParams(next, { replace: true });
    };

    const meta = status === ALL ? { label: 'All', value: ALL } : statusMeta(status);
    const tabs = [{ value: ALL, label: 'All', color: null }, ...LIST_STATUSES];
    const showSkeleton = isPending || !username;
    const empty = !showSkeleton && !isError && entries.length === 0;

    return (
        <>
            <SEO customTitle="My list | AniShows" noIndex />
            <div className="page-container pt-6 pb-16 md:pt-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="page-title">My list</h1>
                        <p className="mt-1 text-sm text-gray-400 tabular">
                            {total ? `${total} anime · ${summary?.episodes_watched ?? 0} episodes watched` : 'Everything you track, in one place.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link to="/import" className="btn-ghost text-sm">
                            <Download aria-hidden="true" className="h-4 w-4" />
                            Import
                        </Link>
                        {username && (
                            <Link to={`/u/${username}`} className="btn-ghost text-sm">Profile</Link>
                        )}
                    </div>
                </header>

                {/* Status tabs: fixed colours, one label each (T7), counts from the summary. */}
                <nav aria-label="List status" className="scroll-fade -mx-4 mt-6 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
                    <ul className="flex min-w-max gap-1">
                        {tabs.map((item) => {
                            const active = item.value === status;
                            const count = item.value === ALL ? summary?.total : summary?.counts?.[item.value];
                            // Empty statuses stay out of the way (the URL still opens them).
                            if (count === 0 && !active && item.value !== ALL && item.value !== 'Watching') return null;
                            return (
                                <li key={item.value}>
                                    <button
                                        type="button"
                                        onClick={() => setStatus(item.value)}
                                        aria-current={active ? 'page' : undefined}
                                        className={`relative flex min-h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${active ? 'bg-white/[0.07] text-white' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'}`}
                                    >
                                        {item.color && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />}
                                        {item.label}
                                        {count != null && <span className="text-xs font-medium text-gray-500 tabular">{count}</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                    <label className="relative flex-1 min-w-[12rem]">
                        <span className="sr-only">Search in {meta?.label}</span>
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={status === ALL ? 'Search your list' : `Search ${meta?.label.toLowerCase()}`}
                            className="input h-11 w-full !py-0 !pl-10 text-[15px]"
                        />
                    </label>
                    <CustomSelect
                        value={ordering}
                        onChange={setOrdering}
                        options={LIST_ORDERINGS}
                        ariaLabel="Sort"
                        triggerClassName="h-11 rounded-lg bg-dark-100 px-3 text-sm"
                    />
                    <div role="group" aria-label="View" className="flex rounded-lg bg-white/[0.04] p-0.5">
                        {[
                            { id: 'grid', label: 'Grid', icon: LayoutGrid },
                            { id: 'table', label: 'Table', icon: Rows3 },
                        ].map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => setView(option.id)}
                                aria-pressed={view === option.id}
                                aria-label={`${option.label} view`}
                                className={`flex h-10 w-11 items-center justify-center rounded-md transition-colors ${view === option.id ? 'bg-white/[0.1] text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                <option.icon aria-hidden="true" className="h-4 w-4" />
                            </button>
                        ))}
                    </div>
                </div>

                <section aria-live="polite" aria-busy={showSkeleton || isPlaceholderData || undefined} className="mt-6">
                    {isError ? (
                        <EmptyState
                            title="Your list didn’t load"
                            actions={<button type="button" onClick={() => refetch()} className="btn-secondary text-sm">Try again</button>}
                        >
                            The server didn’t answer. Nothing was changed.
                        </EmptyState>
                    ) : empty ? (
                        <EmptyState
                            icon={Tv}
                            title={search ? `No match for “${search}”` : EMPTY_COPY[status].title}
                            actions={search ? null : (
                                <>
                                    <Link to="/browse" className="btn-primary text-sm">Browse anime</Link>
                                    {total === 0 && <Link to="/import" className="btn-secondary text-sm">Import from MAL or AniList</Link>}
                                </>
                            )}
                        >
                            {search ? 'Try another title, or another tab.' : EMPTY_COPY[status].body}
                        </EmptyState>
                    ) : view === 'grid' ? (
                        <div className={`grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 anime-card-grid-gap transition-opacity duration-200 ${isPlaceholderData ? 'opacity-60' : ''}`}>
                            {showSkeleton
                                ? Array.from({ length: 12 }, (_, i) => <CardSkeleton key={i} />)
                                : entries.map((entry, index) => (
                                    <AnimeCard
                                        key={entry.id}
                                        anime={entry.anime}
                                        userListEntry={entry}
                                        index={index}
                                        showProgress={entry.status === 'Watching'}
                                        showStatusDot={status === ALL}
                                        metaText={entry.status === 'Watching' ? null : progressText(entry.episodes_watched, entry.anime)}
                                    />
                                ))}
                        </div>
                    ) : (
                        <div className="panel !px-3 !py-2 sm:!px-4">
                            <div aria-hidden="true" className="hidden grid-cols-[2.75rem_minmax(0,1fr)_11rem_4.5rem_9rem_6.5rem] gap-x-4 py-2.5 text-sm font-semibold text-gray-300 sm:grid">
                                <span />
                                <span>Title</span>
                                <span>Progress</span>
                                <span>Score</span>
                                <span>{status === ALL ? 'Status' : ''}</span>
                                <span>Updated</span>
                            </div>
                            {showSkeleton ? (
                                Array.from({ length: 8 }, (_, i) => <RowSkeleton key={i} />)
                            ) : (
                                <ul className={isPlaceholderData ? 'opacity-60' : ''}>
                                    {entries.map((entry) => <LibraryRow key={entry.id} entry={entry} quietStatus={status !== ALL} />)}
                                </ul>
                            )}
                        </div>
                    )}
                    <div ref={sentinel} className="flex h-16 items-center justify-center">
                        {isFetchingNextPage && <Loader2 aria-label="Loading more" className="h-5 w-5 animate-spin text-gray-500" />}
                    </div>
                </section>
            </div>
        </>
    );
}
