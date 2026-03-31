import { useQuery } from '@tanstack/react-query';
import { animeApi } from '../../api/client';
import CategoryRow from './CategoryRow';

const ROW_PAGE_SIZE = 6;

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
        queryFn: () => animeApi.getAll({ sort: 'trending', page_size: ROW_PAGE_SIZE }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 15,
    });

    const { data: popularSeason, isLoading: popularSeasonLoading } = useQuery({
        queryKey: ['anime', 'browse-row', 'popular-season', currentSeason, y],
        queryFn: () => animeApi.getAll({ season: currentSeason, year: y, sort: 'popular', page_size: ROW_PAGE_SIZE }).then(res => res.data.results || res.data),
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

    return (
        <div className="space-y-2 md:space-y-6 pb-0 sm:pb-8 pt-2">
            <CategoryRow 
                title="Trending Now" 
                animeList={trending} 
                isLoading={trendingLoading} 
                viewAllLink="/browse?sort=trending" 
            />
            <CategoryRow 
                title="Popular This Season" 
                animeList={popularSeason} 
                isLoading={popularSeasonLoading} 
                viewAllLink={`/browse?season=${currentSeason}&year=${y}&sort=popular`} 
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
