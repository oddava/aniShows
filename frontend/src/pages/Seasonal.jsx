import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Star, Users } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { animeApi } from '../api/client';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import SEO from '../components/SEO';

const SEASONS = [
    { value: 'winter', label: 'Winter', months: 'Jan - Mar', color: 'bg-blue-500' },
    { value: 'spring', label: 'Spring', months: 'Apr - Jun', color: 'bg-pink-500' },
    { value: 'summer', label: 'Summer', months: 'Jul - Sep', color: 'bg-yellow-500' },
    { value: 'fall', label: 'Fall', months: 'Oct - Dec', color: 'bg-amber-600' },
];

// Get current season
const getCurrentSeason = () => {
    const month = new Date().getMonth();
    if (month >= 0 && month <= 2) return 'winter';
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    return 'fall';
};

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => currentYear + 1 - i);

// Custom hook for analytics
const useAnalytics = () => {
    const trackEvent = useCallback((eventName, params = {}) => {
        if (window.gtag) {
            window.gtag('event', eventName, params);
        }
    }, []);
    return { trackEvent };
};

export default function Seasonal() {
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const { trackEvent } = useAnalytics();
    const seasonTabsRef = useRef(null);
    
    const selectedSeason = searchParams.get('season') || getCurrentSeason();
    const selectedYear = parseInt(searchParams.get('year')) || currentYear;

    useEffect(() => {
        document.title = `${SEASONS.find(s => s.value === selectedSeason)?.label} ${selectedYear} Anime - AniShows`;
    }, [selectedSeason, selectedYear]);

    // Prefetch adjacent seasons
    const prefetchAdjacentSeasons = useCallback(() => {
        const currentIndex = SEASONS.findIndex(s => s.value === selectedSeason);
        
        // Prefetch next season
        const nextIndex = (currentIndex + 1) % 4;
        const nextSeason = SEASONS[nextIndex];
        const nextYear = nextIndex === 0 ? selectedYear + 1 : selectedYear;
        
        queryClient.prefetchQuery({
            queryKey: ['seasonal', nextSeason.value, nextYear],
            queryFn: () => animeApi.getAll({
                season: nextSeason.value,
                year: nextYear,
                sort: 'popular',
                page_size: 50,
            }).then(res => res.data),
            staleTime: 1000 * 60 * 10,
        });

        // Prefetch previous season
        const prevIndex = currentIndex === 0 ? 3 : currentIndex - 1;
        const prevSeason = SEASONS[prevIndex];
        const prevYear = prevIndex === 3 ? selectedYear - 1 : selectedYear;
        
        queryClient.prefetchQuery({
            queryKey: ['seasonal', prevSeason.value, prevYear],
            queryFn: () => animeApi.getAll({
                season: prevSeason.value,
                year: prevYear,
                sort: 'popular',
                page_size: 50,
            }).then(res => res.data),
            staleTime: 1000 * 60 * 10,
        });
    }, [selectedSeason, selectedYear, queryClient]);

    useEffect(() => {
        prefetchAdjacentSeasons();
    }, [prefetchAdjacentSeasons]);

    // Fetch anime for this season
    const { data: animeData, isLoading, isError, refetch } = useQuery({
        queryKey: ['seasonal', selectedSeason, selectedYear],
        queryFn: () => animeApi.getAll({
            season: selectedSeason,
            year: selectedYear,
            sort: 'popular',
            page_size: 50,
        }).then(res => res.data),
        staleTime: 1000 * 60 * 10,
    });

    const animeList = animeData?.results || [];

    const updateSeason = useCallback((season) => {
        trackEvent('season_change', { 
            from_season: selectedSeason, 
            to_season: season,
            year: selectedYear 
        });
        const params = new URLSearchParams(searchParams);
        params.set('season', season);
        setSearchParams(params);
    }, [searchParams, setSearchParams, selectedSeason, selectedYear, trackEvent]);

    const updateYear = useCallback((year) => {
        trackEvent('year_change', { 
            from_year: selectedYear, 
            to_year: year,
            season: selectedSeason 
        });
        const params = new URLSearchParams(searchParams);
        params.set('year', year.toString());
        setSearchParams(params);
    }, [searchParams, setSearchParams, selectedYear, selectedSeason, trackEvent]);

    const navigateSeason = useCallback((direction) => {
        const currentIndex = SEASONS.findIndex(s => s.value === selectedSeason);
        let newIndex = currentIndex + direction;
        let newYear = selectedYear;

        if (newIndex < 0) {
            newIndex = 3;
            newYear -= 1;
        } else if (newIndex > 3) {
            newIndex = 0;
            newYear += 1;
        }

        trackEvent('season_navigate', { 
            direction: direction > 0 ? 'next' : 'previous',
            season: SEASONS[newIndex].value,
            year: newYear
        });

        const params = new URLSearchParams();
        params.set('season', SEASONS[newIndex].value);
        params.set('year', newYear.toString());
        setSearchParams(params);
    }, [selectedSeason, selectedYear, setSearchParams, trackEvent]);

    // Keyboard navigation handler
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'ArrowLeft') {
            navigateSeason(-1);
        } else if (e.key === 'ArrowRight') {
            navigateSeason(1);
        }
    }, [navigateSeason]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const currentSeasonData = SEASONS.find(s => s.value === selectedSeason);

    // Calculate stats with null safety
    const highlyRatedCount = animeList.filter(a => a.rating && parseFloat(a.rating) >= 8).length;

    return (
        <>
            <SEO 
                page="seasonal" 
                customTitle={`${currentSeasonData?.label} ${selectedYear} Anime - AniShows`}
                customDescription={`Discover anime airing in ${currentSeasonData?.label} ${selectedYear}. Browse the seasonal anime lineup with ratings, reviews, and community favorites.`}
            />
            <main className="min-h-screen py-8 px-4" role="main" aria-label="Seasonal Anime Page">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <header className="text-center mb-12">
                        <div className="flex items-center justify-center gap-4 mb-4">
                            <button
                                onClick={() => navigateSeason(-1)}
                                className="p-2 rounded-full bg-dark-100 border border-gray-700 hover:border-accent transition-colors"
                                aria-label="Previous season"
                            >
                                <ChevronLeft className="w-5 h-5 text-gray-400" aria-hidden="true" />
                            </button>

                            <div className="text-center">
                                <h1 className="text-3xl md:text-4xl font-bold text-white">
                                    {currentSeasonData?.label} {selectedYear}
                                </h1>
                                <p className="text-gray-400 text-sm">{currentSeasonData?.months}</p>
                            </div>

                            <button
                                onClick={() => navigateSeason(1)}
                                className="p-2 rounded-full bg-dark-100 border border-gray-700 hover:border-accent transition-colors"
                                aria-label="Next season"
                            >
                                <ChevronRight className="w-5 h-5 text-gray-400" aria-hidden="true" />
                            </button>
                        </div>

                        <p className="text-gray-400 max-w-xl mx-auto">
                            Discover anime airing in {currentSeasonData?.label} {selectedYear}
                        </p>
                    </header>

                    {/* Season/Year Selector */}
                    <nav 
                        className="flex flex-wrap items-center justify-center gap-4 mb-10"
                        aria-label="Season and Year Selector"
                    >
                        {/* Season Pills */}
                        <div 
                            ref={seasonTabsRef}
                            className="flex items-center bg-dark-100 rounded-xl p-1 border border-gray-800"
                            role="tablist"
                            aria-label="Select Season"
                        >
                            {SEASONS.map((season) => (
                                <button
                                    key={season.value}
                                    onClick={() => updateSeason(season.value)}
                                    role="tab"
                                    aria-selected={selectedSeason === season.value}
                                    aria-label={`${season.label} season`}
                                    tabIndex={selectedSeason === season.value ? 0 : -1}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedSeason === season.value
                                        ? `${season.color} text-white shadow-lg`
                                        : 'text-gray-400 hover:text-white'
                                        }`}
                                >
                                    {season.label}
                                </button>
                            ))}
                        </div>

                        {/* Year Dropdown */}
                        <label htmlFor="year-select" className="sr-only">Select Year</label>
                        <select
                            id="year-select"
                            value={selectedYear}
                            onChange={(e) => updateYear(parseInt(e.target.value))}
                            className="px-4 py-2.5 bg-dark-100 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-accent cursor-pointer"
                            aria-label="Select year"
                        >
                            {YEAR_OPTIONS.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </nav>

                    {/* Stats Bar */}
                    {animeList.length > 0 && !isLoading && (
                        <div 
                            className="flex items-center justify-center gap-6 mb-10 py-4 px-6 bg-dark-100/50 rounded-2xl border border-gray-800"
                            role="status"
                            aria-live="polite"
                            aria-label="Season statistics"
                        >
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-accent" aria-hidden="true" />
                                <span className="text-white font-bold">{animeList.length}</span>
                                <span className="text-gray-400">anime this season</span>
                            </div>
                            <div className="w-px h-6 bg-gray-700" aria-hidden="true" />
                            <div className="flex items-center gap-2">
                                <Star className="w-5 h-5 text-yellow-500" aria-hidden="true" />
                                <span className="text-white font-bold">
                                    {highlyRatedCount}
                                </span>
                                <span className="text-gray-400">rated 8+</span>
                            </div>
                        </div>
                    )}

                    {/* Content */}
                    {isLoading ? (
                        <div 
                            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6"
                            role="status"
                            aria-label="Loading anime"
                        >
                            {Array(12).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                        </div>
                    ) : isError ? (
                        <div className="text-center py-16" role="alert" aria-live="assertive">
                            <p className="text-red-400 mb-4">Failed to load seasonal anime</p>
                            <button 
                                onClick={() => refetch()} 
                                className="btn-primary"
                                aria-label="Retry loading anime"
                            >
                                Retry
                            </button>
                        </div>
                    ) : animeList.length === 0 ? (
                        <div className="text-center py-16">
                            <p className="text-gray-400 mb-4">No anime found for {currentSeasonData?.label} {selectedYear}</p>
                            <Link to="/browse" className="btn-primary">
                                Browse All Anime
                            </Link>
                        </div>
                    ) : (
                        <div 
                            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6"
                            role="list"
                            aria-label={`${animeList.length} anime in ${currentSeasonData?.label} ${selectedYear}`}
                        >
                            {animeList.map((anime) => (
                                <AnimeCard key={anime.id} anime={anime} />
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </>
    );
}
