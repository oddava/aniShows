import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import CategoryRow from './CategoryRow';
import { animeQueries } from '../../api/queries/anime';

const ROW_PAGE_SIZE = 6;
const PLACEHOLDER_ROWS = [
    { key: 'trending', title: 'Trending now' },
    { key: 'popular-season', title: 'Popular this season' },
    { key: 'upcoming', title: 'Upcoming next season' },
    { key: 'all-time', title: 'All-time popular' },
    { key: 'top-rated', title: 'Top rated' },
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

function buildBrowseLink(baseParams) {
    const params = new URLSearchParams(baseParams);
    return `/browse?${params.toString()}`;
}

export default function BrowseRowMode({ titleLanguage = 'en' }) {
    const { user } = useAuth();
    const adultContentEnabled = Boolean(user?.show_adult_content);

    const { data: browseRows = [], isLoading, isError, isFetching, refetch } = useQuery({
        ...animeQueries.browseRows(adultContentEnabled),
        retry: 1,
    });

    const rows = useMemo(() => {
        const seenIds = new Set();
        const resolvedRows = [];

        for (const row of browseRows) {
            const uniqueItems = takeUniqueAnime(row.anime_list, seenIds);
            // Hiding shelves with no unique cards avoids duplicated rows that read like a backend bug.
            if (!isLoading && uniqueItems.length === 0) continue;

            resolvedRows.push({
                ...row,
                animeList: uniqueItems,
                // "View all" should open the full category, not the deduplicated landing-page slice.
                viewAllLink: buildBrowseLink(row.browse_params),
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
                        className="btn-secondary text-sm"
                    >
                        Browse all anime
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
                    titleLanguage={titleLanguage}
                />
            ))}
        </div>
    );
}

BrowseRowMode.propTypes = {
    titleLanguage: PropTypes.oneOf(['en', 'jp']),
};
