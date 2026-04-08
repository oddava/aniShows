import { useQuery } from '@tanstack/react-query';
import { animeApi } from '../../api/client';
import CategoryRow from './CategoryRow';

const ROW_PAGE_SIZE = 6;
const FETCH_PAGE_SIZE = 18;

function uniqueById(items) {
    const list = Array.isArray(items) ? items : [];
    const seen = new Set();

    return list.filter((item) => {
        if (!item?.id || seen.has(item.id)) {
            return false;
        }
        seen.add(item.id);
        return true;
    });
}

function excludeIds(items, blockedIds, limit = ROW_PAGE_SIZE) {
    const list = Array.isArray(items) ? items : [];
    const blocked = blockedIds instanceof Set ? blockedIds : new Set();

    return list.filter((item) => item?.id && !blocked.has(item.id)).slice(0, limit);
}

function buildPopularSeasonViewAllLink(season, year, excludedIds) {
    const params = new URLSearchParams({
        season,
        year: String(year),
        sort: 'popular',
    });

    if (excludedIds.length > 0) {
        params.set('exclude_ids', excludedIds.join(','));
    }

    return `/browse?${params.toString()}`;
}

export default function BrowseRowMode({ titleLanguage }) {
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
        queryKey: ['anime', 'browse-row', 'trending'],
        queryFn: () => animeApi.getAll({ sort: 'trending', page_size: FETCH_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: popularSeason, isLoading: popularSeasonLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'popular-season', currentSeason, y],
        queryFn: () => animeApi.getAll({ season: currentSeason, year: y, sort: 'popular', page_size: FETCH_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: upcoming, isLoading: upcomingLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'upcoming', nextSeason, nextYear],
        queryFn: () => animeApi.getAll({ season: nextSeason, year: nextYear, sort: 'popular', page_size: ROW_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: allTime, isLoading: allTimeLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'all-time'],
        queryFn: () => animeApi.getAll({ sort: 'popular', page_size: ROW_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'top-rated'],
        queryFn: () => animeApi.getAll({ sort: 'rating', page_size: ROW_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const trendingUnique = uniqueById(trending);
    const trendingRow = trendingUnique.slice(0, ROW_PAGE_SIZE);
    const trendingIds = new Set(trendingRow.map((anime) => anime.id));
    const popularSeasonRow = excludeIds(uniqueById(popularSeason), trendingIds);
    const popularSeasonViewAllLink = buildPopularSeasonViewAllLink(
        currentSeason,
        y,
        trendingRow.map((anime) => anime.id)
    );

    return (
        <div className="space-y-2 md:space-y-6 pb-0 sm:pb-8 pt-2">
            <CategoryRow 
                title="Trending Now" 
                animeList={trendingRow} 
                isLoading={trendingLoading} 
                viewAllLink="/browse?sort=trending" 
            />
            <CategoryRow 
                title="Popular This Season" 
                animeList={popularSeasonRow} 
                isLoading={popularSeasonLoading} 
                viewAllLink={popularSeasonViewAllLink} 
            />
            <CategoryRow 
                title="Upcoming Next Season" 
                animeList={upcoming} 
                isLoading={upcomingLoading} 
                viewAllLink={`/browse?season=${nextSeason}&year=${nextYear}&sort=popular`} 
            />
            <CategoryRow 
                title="All Time Popular" 
                animeList={allTime} 
                isLoading={allTimeLoading} 
                viewAllLink="/browse?sort=popular" 
            />
            <CategoryRow 
                title="Top Rated" 
                animeList={topRated} 
                isLoading={topRatedLoading} 
                viewAllLink="/browse?sort=rating" 
            />
        </div>
    );
}
