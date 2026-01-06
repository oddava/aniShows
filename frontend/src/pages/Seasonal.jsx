import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock, Star, Users } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { animeApi } from '../api/client';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';

const SEASONS = [
    { value: 'winter', label: 'Winter', months: 'Jan - Mar', color: 'bg-blue-500' },
    { value: 'spring', label: 'Spring', months: 'Apr - Jun', color: 'bg-pink-500' },
    { value: 'summer', label: 'Summer', months: 'Jul - Sep', color: 'bg-yellow-500' },
    { value: 'fall', label: 'Fall', months: 'Oct - Dec', color: 'bg-amber-600' },
];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

export default function Seasonal() {
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedSeason = searchParams.get('season') || getCurrentSeason();
    const selectedYear = parseInt(searchParams.get('year')) || currentYear;
    const [groupByDay, setGroupByDay] = useState(false);

    useEffect(() => {
        document.title = `${SEASONS.find(s => s.value === selectedSeason)?.label} ${selectedYear} Anime - AniShows`;
    }, [selectedSeason, selectedYear]);

    // Fetch anime for this season
    const { data: animeData, isLoading, isError } = useQuery({
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

    // Group by day of week for airing anime
    const groupedByDay = useMemo(() => {
        if (!groupByDay) return null;
        const groups = {};
        DAYS_OF_WEEK.forEach(day => groups[day] = []);

        animeList.forEach(anime => {
            // For now, distribute by ID modulo (since we don't have broadcast day data)
            // In production, you'd use actual broadcast schedule
            const dayIndex = anime.id % 7;
            groups[DAYS_OF_WEEK[dayIndex]].push(anime);
        });

        return groups;
    }, [animeList, groupByDay]);

    const updateSeason = (season) => {
        const params = new URLSearchParams(searchParams);
        params.set('season', season);
        setSearchParams(params);
    };

    const updateYear = (year) => {
        const params = new URLSearchParams(searchParams);
        params.set('year', year.toString());
        setSearchParams(params);
    };

    const navigateSeason = (direction) => {
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

        const params = new URLSearchParams();
        params.set('season', SEASONS[newIndex].value);
        params.set('year', newYear.toString());
        setSearchParams(params);
    };

    const currentSeasonData = SEASONS.find(s => s.value === selectedSeason);

    return (
        <div className="min-h-screen py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center gap-4 mb-4">
                        <button
                            onClick={() => navigateSeason(-1)}
                            className="p-2 rounded-full bg-dark-100 border border-gray-700 hover:border-accent transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-400" />
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
                        >
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>

                    <p className="text-gray-400 max-w-xl mx-auto">
                        Discover anime airing in {currentSeasonData?.label} {selectedYear}
                    </p>
                </div>

                {/* Season/Year Selector */}
                <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
                    {/* Season Pills */}
                    <div className="flex items-center bg-dark-100 rounded-xl p-1 border border-gray-800">
                        {SEASONS.map((season) => (
                            <button
                                key={season.value}
                                onClick={() => updateSeason(season.value)}
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
                    <select
                        value={selectedYear}
                        onChange={(e) => updateYear(parseInt(e.target.value))}
                        className="px-4 py-2.5 bg-dark-100 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-accent cursor-pointer"
                    >
                        {YEAR_OPTIONS.map((year) => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>

                    {/* Group by Day Toggle */}
                    <button
                        onClick={() => setGroupByDay(!groupByDay)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${groupByDay
                            ? 'bg-accent text-white'
                            : 'bg-dark-100 border border-gray-700 text-gray-400 hover:text-white'
                            }`}
                    >
                        <Clock className="w-4 h-4" />
                        Group by Day
                    </button>
                </div>

                {/* Stats Bar */}
                {animeList.length > 0 && (
                    <div className="flex items-center justify-center gap-6 mb-10 py-4 px-6 bg-dark-100/50 rounded-2xl border border-gray-800">
                        <div className="flex items-center gap-2">
                            <Users className="w-5 h-5 text-accent" />
                            <span className="text-white font-bold">{animeList.length}</span>
                            <span className="text-gray-400">anime this season</span>
                        </div>
                        <div className="w-px h-6 bg-gray-700" />
                        <div className="flex items-center gap-2">
                            <Star className="w-5 h-5 text-yellow-500" />
                            <span className="text-white font-bold">
                                {animeList.filter(a => parseFloat(a.rating) >= 8).length}
                            </span>
                            <span className="text-gray-400">rated 8+</span>
                        </div>
                    </div>
                )}

                {/* Content */}
                {isLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                        {Array(12).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)}
                    </div>
                ) : isError ? (
                    <div className="text-center py-16">
                        <p className="text-red-400 mb-4">Failed to load seasonal anime</p>
                        <button onClick={() => window.location.reload()} className="btn-primary">
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
                ) : groupByDay && groupedByDay ? (
                    <div className="space-y-12">
                        {DAYS_OF_WEEK.map((day) => {
                            const dayAnime = groupedByDay[day];
                            if (dayAnime.length === 0) return null;
                            return (
                                <div key={day}>
                                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                                        <div className="w-1 h-6 bg-accent rounded-full" />
                                        {day}
                                        <span className="text-sm font-normal text-gray-500">({dayAnime.length} shows)</span>
                                    </h2>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                                        {dayAnime.map((anime) => (
                                            <AnimeCard key={anime.id} anime={anime} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                        {animeList.map((anime) => (
                            <AnimeCard key={anime.id} anime={anime} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
