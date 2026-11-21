import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { activityApi } from '../../api/client';
import { Link } from 'react-router-dom';
import AnimeMediaImage from '../common/AnimeMediaImage';
import { formatDateInUserTimezone } from '../../utils/dateUtils';
import { activityKeys, listKeys } from '../../api/queries/user';
import { LIST_STATUSES, statusLabel } from '../../utils/listStatus';
import { statusesFromEntries, tidyActivities } from './activityTidy';

// The overview shows a handful of rows; it asks for more than that because
// tidying (dropped churn, merged runs) can leave fewer rows than events.
const COMPACT_ROWS = 6;
const COMPACT_FETCH = 40;
const PAGE_SIZE = 50;
// When a page tidies down to a few rows, fetch on by itself (up to this many
// pages) until there are enough rows to read.
const AUTO_PAGES = 4;
const MIN_ROWS = 8;

// `value` is the list status the server filters on (`?status=`): the entry's new
// status, or the old one for removals. Labels and colours: utils/listStatus.
const FILTER_OPTIONS = [
    { value: 'all', label: 'All' },
    ...LIST_STATUSES.map(({ value, label, color }) => ({ value, label, color })),
];

function renderActivityDescription(activity) {
    // The server writes the stored status value ("Plan to Watch"); people read
    // the label ("Planning"), as everywhere else.
    const description = (activity?.activity_description || '')
        .split('Plan to Watch').join(statusLabel('Plan to Watch'))
        .split('On Hold').join(statusLabel('On Hold'));
    if (!description) return '';
    const ranges = [];
    const pushRange = (start, end, className, priority = 1, linkTo = null) => {
        if (start < 0 || end <= start) return;
        ranges.push({ start, end, className, priority, linkTo });
    };

    // Highlight anime title with accent and make it clickable.
    const animeTitle = activity?.anime?.title || '';
    const animeSlug = activity?.anime?.slug;
    if (animeTitle) {
        const titleIndex = description.toLowerCase().indexOf(animeTitle.toLowerCase());
        if (titleIndex >= 0) {
            pushRange(
                titleIndex,
                titleIndex + animeTitle.length,
                'font-medium text-[var(--text-1)]',
                3,
                animeSlug ? `/anime/${animeSlug}` : null
            );
        }
    }

    if (ranges.length === 0) return description;

    const boundaries = new Set([0, description.length]);
    ranges.forEach((range) => {
        boundaries.add(range.start);
        boundaries.add(range.end);
    });
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

    const nodes = [];
    for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
        const start = sortedBoundaries[i];
        const end = sortedBoundaries[i + 1];
        const text = description.slice(start, end);
        if (!text) continue;

        const activeRanges = ranges.filter((range) => range.start <= start && range.end >= end);
        const winner = activeRanges.sort((a, b) => b.priority - a.priority)[0];

        if (!winner) {
            nodes.push(<span key={`${start}-${end}`}>{text}</span>);
            continue;
        }

        if (winner.linkTo) {
            nodes.push(
                <Link
                    key={`${start}-${end}`}
                    to={winner.linkTo}
                    className={`${winner.className} transition-colors hover:text-[var(--signature)]`}
                >
                    {text}
                </Link>
            );
            continue;
        }

        nodes.push(
            <span key={`${start}-${end}`} className={winner.className}>
                {text}
            </span>
        );
    }

    return nodes;
}

function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return formatDateInUserTimezone(date, { month: 'short', day: 'numeric' });
}

function formatDateGroupLabel(dateValue) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const toDateKey = (value) => formatDateInUserTimezone(value, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    if (toDateKey(dateValue) === toDateKey(today)) return 'Today';
    if (toDateKey(dateValue) === toDateKey(yesterday)) return 'Yesterday';

    return formatDateInUserTimezone(dateValue, {
        month: 'long',
        day: 'numeric',
        year: dateValue.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
}

function groupActivitiesByDate(activities) {
    const groupsMap = new Map();
    const grouped = [];

    activities.forEach(activity => {
        const activityDate = new Date(activity.created_at);
        const dateKey = formatDateInUserTimezone(activityDate, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });

        if (!groupsMap.has(dateKey)) {
            const dateGroup = {
                key: dateKey,
                label: formatDateGroupLabel(activityDate),
                activities: [],
            };
            groupsMap.set(dateKey, dateGroup);
            grouped.push(dateGroup);
        }
        groupsMap.get(dateKey).activities.push(activity);
    });

    return grouped;
}

function parseNextPage(lastPage) {
    if (!lastPage?.next) return undefined;

    try {
        const parsed = new URL(lastPage.next, 'http://localhost');
        const page = Number(parsed.searchParams.get('page'));
        return Number.isFinite(page) && page > 0 ? page : undefined;
    } catch {
        return undefined;
    }
}

function EmptyState({ filterType }) {
    return (
        <p className=" pt-6 text-[17px] text-[var(--text-2)]">
            {filterType !== 'all'
                ? 'Nothing with this status yet. Try another one.'
                : 'No activity yet. It shows up here when a list changes.'}
        </p>
    );
}

function ActivityRow({ activity }) {
    const anime = activity.anime;
    const title = anime?.title || 'Unknown title';

    return (
        <li className="flex items-center gap-4 py-3 ">
            {anime?.slug ? (
                <Link to={`/anime/${anime.slug}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
                    <AnimeMediaImage
                        anime={anime}
                        kind="cover"
                        size="small"
                        alt=""
                        className="h-14 w-10 rounded-md bg-[var(--ink-2)] object-cover"
                        loading="lazy"
                    />
                </Link>
            ) : (
                <span aria-hidden="true" className="h-14 w-10 shrink-0 rounded-md bg-[var(--ink-2)]" />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug text-[var(--text-2)]">
                    {renderActivityDescription(activity) || title}
                </p>
                {activity.notes && (
                    <p className="mt-1 line-clamp-2 text-sm italic text-[var(--text-2)]">“{activity.notes}”</p>
                )}
            </div>
            <span className="shrink-0 text-sm text-[var(--text-3)] tabular">{timeAgo(activity.created_at)}</span>
        </li>
    );
}

/**
 * List entries of this profile the client already holds (the overview's
 * Watching rows, a list tab it opened), oldest fetch first so the freshest
 * copy of an entry wins. No request of its own.
 */
function cachedListEntries(queryClient, username) {
    const queries = queryClient.getQueryCache()
        .findAll({ queryKey: [listKeys.all[0], username] })
        .filter((query) => query.state.data)
        .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
    return queries.flatMap(({ state: { data } }) => {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.pages)) return data.pages.flatMap((page) => page?.results || []);
        return Array.isArray(data?.results) ? data.results : [];
    });
}

/**
 * A profile's list activity, newest first, in rows grouped by day, tidied
 * (see activityTidy): no add/remove churn, one row per burst of changes, and
 * no status row the show's loaded list entry has since contradicted.
 * `compact` (the overview) drops the filters, shows a handful of rows, and
 * renders nothing at all (header included) when there is no activity.
 * `currentEntries`: list entries the caller has loaded (newest data).
 */
export default function ActivityFeed({ username, isPrivate, isOwner = false, compact = false, header = null, currentEntries = null }) {
    const queryClient = useQueryClient();
    const [filterType, setFilterType] = useState('all');
    const pageSize = compact ? COMPACT_FETCH : PAGE_SIZE;

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetching,
        isLoading,
        isError,
        refetch,
    } = useInfiniteQuery({
        queryKey: activityKeys.feed(username, filterType, pageSize),
        queryFn: ({ pageParam }) =>
            activityApi.getFeed({
                username,
                page: pageParam,
                page_size: pageSize,
                ...(filterType !== 'all' ? { status: filterType } : {}),
            }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: parseNextPage,
        enabled: !isPrivate && !!username,
        placeholderData: keepPreviousData,
        staleTime: 2 * 60 * 1000,
    });

    const rawCount = data?.pages?.reduce((total, page) => total + (page?.results?.length || 0), 0) || 0;
    const activities = useMemo(() => {
        const currentStatus = statusesFromEntries([
            ...cachedListEntries(queryClient, username),
            ...(currentEntries || []),
        ]);
        return tidyActivities(data?.pages?.flatMap(page => page?.results || []) || [], { isOwner, currentStatus });
    }, [currentEntries, data, isOwner, queryClient, username]);
    const pagesLoaded = data?.pages?.length || 0;

    // Most of what loaded was churn: look further back before showing a short
    // feed (or "nothing yet").
    const wantedRows = compact ? COMPACT_ROWS : MIN_ROWS;
    // While it looks further back by itself, the feed shows skeletons, not a
    // single row that then jumps.
    const autoPaging = hasNextPage && rawCount > 0 && activities.length < wantedRows && pagesLoaded < AUTO_PAGES;
    useEffect(() => {
        if (isFetching || !hasNextPage || rawCount === 0) return;
        if (activities.length < wantedRows && pagesLoaded < AUTO_PAGES) fetchNextPage();
    }, [activities.length, fetchNextPage, hasNextPage, isFetching, pagesLoaded, rawCount, wantedRows]);

    const dateGroups = useMemo(
        () => groupActivitiesByDate(activities),
        [activities]
    );
    const isFilterUpdating = isFetching && !isFetchingNextPage;
    const [stableDateGroups, setStableDateGroups] = useState([]);

    useEffect(() => {
        if (!isLoading && !isError && !isFilterUpdating) {
            setStableDateGroups(dateGroups);
        }
    }, [dateGroups, isError, isFilterUpdating, isLoading]);

    const visibleDateGroups = isFilterUpdating && stableDateGroups.length > 0
        ? stableDateGroups
        : dateGroups;
    const visibleActivityCount = visibleDateGroups.reduce(
        (total, group) => total + group.activities.length,
        0
    );

    if (isPrivate) {
        return (
            <p className="text-[17px] text-[var(--text-2)]">This profile is private, so its activity is too.</p>
        );
    }

    if (compact) {
        if (isLoading || isError || activities.length === 0) return null;
        return (
            <section>
                {header}
                <ul>
                    {activities.slice(0, COMPACT_ROWS).map((activity) => (
                        <ActivityRow key={activity.id} activity={activity} />
                    ))}
                </ul>
            </section>
        );
    }

    return (
        <section className="space-y-6">
            <div className="scroll-fade -mx-4 flex items-center gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter by status">
                {FILTER_OPTIONS.map((filter) => {
                    const isActive = filterType === filter.value;
                    return (
                        <button
                            key={filter.value}
                            type="button"
                            onClick={() => setFilterType(filter.value)}
                            aria-pressed={isActive}
                            className={`inline-flex min-h-[2.5rem] items-center gap-2 rounded-lg px-3.5 text-sm transition-colors ${isActive
                                ? 'bg-white/[0.08] text-[var(--text-1)]'
                                : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'
                                }`}
                        >
                            {filter.color && (
                                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: filter.color }} />
                            )}
                            {filter.label}
                        </button>
                    );
                })}
                {isFilterUpdating && (
                    <span className="text-sm text-[var(--text-3)]">Updating…</span>
                )}
            </div>

            {(isLoading || autoPaging) && activities.length < wantedRows && (isLoading || isFetching || autoPaging) && (
                <ul aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, index) => (
                        <li key={index} className="flex items-center gap-4 py-3">
                            <span className="h-14 w-10 rounded-md bg-[var(--ink-2)] animate-pulse" />
                            <span className="h-4 w-1/2 rounded bg-[var(--ink-2)] animate-pulse" />
                        </li>
                    ))}
                </ul>
            )}

            {isError && (
                <p className="text-[17px] text-[var(--text-2)]">
                    Couldn’t load the activity.{' '}
                    <button type="button" onClick={() => refetch()} className="text-link">Try again</button>
                </p>
            )}

            {!isLoading && !isError && !isFilterUpdating && !isFetchingNextPage && visibleActivityCount === 0 && (
                <EmptyState filterType={filterType} />
            )}

            {!isLoading && !autoPaging && !isError && visibleActivityCount > 0 && (
                <div className={`space-y-8 transition-opacity duration-200 ${isFilterUpdating ? 'opacity-60' : 'opacity-100'}`}>
                    {visibleDateGroups.map((group) => (
                        <div key={group.key}>
                            <h3 className=" pb-2 text-sm text-[var(--text-2)]">
                                {group.label}
                            </h3>
                            <ul>
                                {group.activities.map((activity) => (
                                    <ActivityRow key={activity.id} activity={activity} />
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {hasNextPage && !autoPaging && !isError && (
                <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="btn-secondary px-5 text-[15px]"
                >
                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
            )}
        </section>
    );
}
