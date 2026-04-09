import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { animeApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import CategoryRow from './CategoryRow';

const ROW_PAGE_SIZE = 6;
const ROW_CANDIDATE_PAGE_SIZE = 18;

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

export default function BrowseRowMode({ titleLanguage }) {
    const { user } = useAuth();
    const adultContentEnabled = Boolean(user?.show_adult_content);

    // Helper to get current and next seasons
    const d = new Date();
    const m = d.getMonth();
    const y = d.getFullYear();
    
    let currentSeason = 'winter';
    if (m >= 3 && m <= 5) currentSeason = 'spring';
    else if (m >= 6 && m <= 8) currentSeason = 'summer';
    else if (m >= 9 && m <= 11) currentSeason = 'fall';

    let nextSeason = 'winter';
    let nextYear = y;
    if (m >= 0 && m <= 2) { nextSeason = 'spring'; }
    else if (m >= 3 && m <= 5) { nextSeason = 'summer'; }
    else if (m >= 6 && m <= 8) { nextSeason = 'fall'; }
    else { nextSeason = 'winter'; nextYear = y + 1; }

    const { data: trending, isLoading: trendingLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'trending', adultContentEnabled],
        queryFn: () => animeApi.getAll({ sort: 'trending', page_size: ROW_CANDIDATE_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: popularSeason, isLoading: popularSeasonLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'popular-season', currentSeason, y, adultContentEnabled],
        queryFn: () => animeApi.getAll({ season: currentSeason, year: y, sort: 'popular', page_size: ROW_CANDIDATE_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: upcoming, isLoading: upcomingLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'upcoming', nextSeason, nextYear, adultContentEnabled],
        queryFn: () => animeApi.getAll({ season: nextSeason, year: nextYear, sort: 'popular', page_size: ROW_CANDIDATE_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: allTime, isLoading: allTimeLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'all-time', adultContentEnabled],
        queryFn: () => animeApi.getAll({ sort: 'popular', page_size: ROW_CANDIDATE_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'top-rated', adultContentEnabled],
        queryFn: () => animeApi.getAll({ sort: 'rating', page_size: ROW_CANDIDATE_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const rows = useMemo(() => {
        const seenIds = new Set();
        const resolvedRows = [];

        const rowConfigs = [
            {
                title: 'Trending Now',
                animeList: trending,
                isLoading: trendingLoading,
                browseParams: { sort: 'trending' },
            },
            {
                title: 'Popular This Season',
                animeList: popularSeason,
                isLoading: popularSeasonLoading,
                browseParams: { season: currentSeason, year: y.toString(), sort: 'popular' },
            },
            {
                title: 'Upcoming Next Season',
                animeList: upcoming,
                isLoading: upcomingLoading,
                browseParams: { season: nextSeason, year: nextYear.toString(), sort: 'popular' },
            },
            {
                title: 'All Time Popular',
                animeList: allTime,
                isLoading: allTimeLoading,
                browseParams: { sort: 'popular' },
            },
            {
                title: 'Top Rated',
                animeList: topRated,
                isLoading: topRatedLoading,
                browseParams: { sort: 'rating' },
            },
        ];

        for (const row of rowConfigs) {
            const excludedIds = [...seenIds];
            const uniqueItems = takeUniqueAnime(row.animeList, seenIds);
            // Hiding shelves with no unique cards avoids duplicated rows that read like a backend bug.
            if (!row.isLoading && uniqueItems.length === 0) continue;

            resolvedRows.push({
                ...row,
                animeList: uniqueItems,
                // "View all" should land on the same deduplicated slice the shelf represented.
                viewAllLink: buildBrowseLink(row.browseParams, excludedIds),
            });
        }

        return resolvedRows;
    }, [
        allTime,
        allTimeLoading,
        currentSeason,
        nextSeason,
        nextYear,
        popularSeason,
        popularSeasonLoading,
        topRated,
        topRatedLoading,
        trending,
        trendingLoading,
        upcoming,
        upcomingLoading,
        y,
    ]);

    return (
        <div className="space-y-2 md:space-y-6 pb-0 sm:pb-8 pt-2">
            {rows.map((row) => (
                <CategoryRow
                    key={row.title}
                    title={row.title}
                    animeList={row.animeList}
                    isLoading={row.isLoading}
                    viewAllLink={row.viewAllLink}
                />
            ))}
        </div>
    );
}
