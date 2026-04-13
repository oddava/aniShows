import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { animeApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import CategoryRow from './CategoryRow';

const ROW_PAGE_SIZE = 6;
const BROWSE_ROWS_TIMEOUT_MS = 12000;
const PLACEHOLDER_ROWS = [
    { key: 'trending', title: 'Trending Now' },
    { key: 'popular-season', title: 'Popular This Season' },
    { key: 'upcoming', title: 'Upcoming Next Season' },
    { key: 'all-time', title: 'All Time Popular' },
    { key: 'top-rated', title: 'Top Rated' },
];

function takeUniqueAnime(animeList = [], seenIds, limit = ROW_PAGE_SIZE) {
    const uniqueItems = [];

    for (const anime of animeList) {
        if (!anime?.id || seenIds.has(anime.id)) continue;

        seenIds.add(anime.id);
        uniqueItems.push(anime);

        if (uniqueItems.length >= limit) break;
    }

    return uniqueItems;
}

function buildBrowseLink(baseParams, excludedIds = []) {
    const params = new URLSearchParams(baseParams);
    if (excludedIds.length > 0) {
        params.set('exclude_ids', excludedIds.join(','));
    }
    return `/browse?${params.toString()}`;
}

export default function BrowseRowMode() {
    const { user } = useAuth();
    const adultContentEnabled = Boolean(user?.show_adult_content);

    const { data: browseRows = [], isLoading, isError, isFetching, refetch } = useQuery({
        queryKey: ['anime', 'browse-row', adultContentEnabled],
        queryFn: ({ signal }) => {
            let timeoutId;
            const request = animeApi.getBrowseRows(signal).then((res) => res.data || []);
            const timeout = new Promise((_, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error('Browse rows request timed out')),
                    BROWSE_ROWS_TIMEOUT_MS,
                );
            });

            return Promise.race([request, timeout]).finally(() => {
                if (timeoutId) clearTimeout(timeoutId);
            });
        },
        staleTime: 1000 * 60 * 15,
        retry: 1,
    });

    const rows = useMemo(() => {
        const seenIds = new Set();
        const resolvedRows = [];

        for (const row of browseRows) {
            const excludedIds = [...seenIds];
            const uniqueItems = takeUniqueAnime(row.anime_list, seenIds);
            // Hiding shelves with no unique cards avoids duplicated rows that read like a backend bug.
            if (!isLoading && uniqueItems.length === 0) continue;

            resolvedRows.push({
                ...row,
                animeList: uniqueItems,
                // "View all" should land on the same deduplicated slice the shelf represented.
                viewAllLink: buildBrowseLink(row.browse_params, excludedIds),
            });
        }

        return resolvedRows;
    }, [
        browseRows,
        isLoading,
    ]);

    if (isError && !isFetching) {
        return (
            <div className="rounded-2xl border border-gray-800 bg-dark-100/60 p-5 sm:p-6">
                <h2 className="text-sm sm:text-base font-semibold text-white">Unable to load browse shelves</h2>
                <p className="mt-2 text-sm text-gray-400">
                    The shelf feed is taking too long to respond. You can retry or open the main browse list.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                    <button
                        onClick={() => refetch()}
                        className="px-4 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                    >
                        Retry
                    </button>
                    <Link
                        to="/browse?sort=popular"
                        className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
                    >
                        Open Browse List
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2 md:space-y-6 pb-0 sm:pb-8 pt-2">
            {(rows.length > 0 ? rows : (isLoading ? PLACEHOLDER_ROWS : browseRows)).map((row, index) => (
                <CategoryRow
                    key={row.key || row.title}
                    title={row.title}
                    animeList={row.animeList || row.anime_list}
                    isLoading={isLoading}
                    viewAllLink={row.viewAllLink}
                    eagerCount={index === 0 ? ROW_PAGE_SIZE : 0}
                />
            ))}
        </div>
    );
}
