import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, TrendingUp, Star, ChevronRight, Sparkles } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { animeApi, listApi, recommendationsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUtils';

export default function Home() {
    const { isAuthenticated } = useAuth();
    const [currentHeroIndex, setCurrentHeroIndex] = useState(0);

    const { data: trending, isLoading: trendingLoading } = useQuery({
        queryKey: ['anime', 'trending'],
        queryFn: () => animeApi.getTrending().then(res => res.data),
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        queryKey: ['anime', 'top_rated'],
        queryFn: () => animeApi.getTopRated().then(res => res.data),
    });

    // Hero Carousel Logic
    useEffect(() => {
        if (!trending || trending.length === 0) return;
        const interval = setInterval(() => {
            setCurrentHeroIndex((prev) => (prev + 1) % Math.min(trending.length, 5));
        }, 8000);
        return () => clearInterval(interval);
    }, [trending]);

    const heroAnime = trending && trending.length > 0 ? trending[currentHeroIndex] : null;

    return (
        <div className="min-h-screen">
            {/* Hero Section - Optimized Real Estate & Visuals */}
            <section className="relative h-[50vh] min-h-[450px] flex items-center justify-center overflow-hidden">
                {/* Dynamic Background */}
                <div className="absolute inset-0 bg-dark">
                    {trending?.slice(0, 5).map((anime, index) => (
                        <div
                            key={anime.id}
                            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentHeroIndex ? 'opacity-40' : 'opacity-0'
                                }`}
                        >
                            <img
                                src={getImageUrl(anime.banner_image || anime.cover_image)}
                                alt=""
                                className="w-full h-full object-cover blur-sm scale-110"
                            />
                        </div>
                    ))}
                    <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/80 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-r from-dark via-transparent to-dark" />
                </div>

                {/* Content */}
                <div className="relative z-10 text-center px-4 max-w-4xl mx-auto pt-10">
                    <div className="mb-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 backdrop-blur-sm">
                        <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse"></span>
                        <span className="text-xs font-medium text-accent-light">Discovery Platform</span>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
                        <span className="text-white">Your Next</span>{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-purple-400">
                            Anime Obsession
                        </span>
                    </h1>
                    <p className="text-base md:text-lg text-gray-300 mb-6 max-w-2xl mx-auto">
                        Track, discover, and share your anime journey with thousands of fans.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <Link to="/browse" className="btn-primary flex items-center gap-2 py-2 px-6 shadow-lg shadow-accent/25 hover:shadow-accent/40">
                            <Play className="w-4 h-4 fill-current" />
                            Start Watching
                        </Link>
                        {!isAuthenticated && (
                            <Link to="/register" className="btn-secondary py-2 px-6 bg-dark/50 backdrop-blur-md hover:bg-dark-50/80">
                                Join Free
                            </Link>
                        )}
                    </div>
                </div>
            </section>

            <div className="space-y-4 md:space-y-8 pb-16 -mt-10 relative z-20">

                {/* Currently Watching Section - Added Utility */}
                {isAuthenticated && (
                    <CurrentlyWatchingSection />
                )}

                {/* Trending Section */}
                <section className="px-4 md:px-6 pt-8 md:pt-12">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex items-center justify-between mb-4 md:mb-6">
                            <div className="flex items-center gap-2 md:gap-3">
                                <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-accent" />
                                <h2 className="text-xl md:text-2xl font-bold text-white">Trending Now</h2>
                            </div>
                            <Link to="/browse?sort=popular" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
                                View All <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>

                        {/* Mobile: Horizontal Scroll, Desktop: Grid */}
                        <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-4 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                            {trendingLoading ? (
                                Array(6).fill(0).map((_, i) => (
                                    <div key={i} className="min-w-[160px] md:min-w-0 snap-start">
                                        <AnimeCardSkeleton />
                                    </div>
                                ))
                            ) : trending?.length > 0 ? (
                                trending.slice(0, 6).map((anime, index) => (
                                    <div key={anime.id} className="min-w-[160px] md:min-w-0 snap-start h-full">
                                        <AnimeCard anime={anime} rank={index + 1} />
                                    </div>
                                ))
                            ) : (
                                <div className="w-full text-center py-8 text-gray-500">No trending anime found</div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Top Rated Section */}
                <section className="px-4 md:px-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex items-center justify-between mb-4 md:mb-6">
                            <div className="flex items-center gap-2 md:gap-3">
                                <Star className="w-5 h-5 md:w-6 md:h-6 text-yellow-400" />
                                <h2 className="text-xl md:text-2xl font-bold text-white">Top Rated</h2>
                            </div>
                            <Link to="/browse?sort=rating" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
                                View All <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>

                        <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-4 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                            {topRatedLoading ? (
                                Array(6).fill(0).map((_, i) => (
                                    <div key={i} className="min-w-[160px] md:min-w-0 snap-start">
                                        <AnimeCardSkeleton />
                                    </div>
                                ))
                            ) : topRated?.length > 0 ? (
                                topRated.slice(0, 6).map((anime) => (
                                    <div key={anime.id} className="min-w-[160px] md:min-w-0 snap-start h-full">
                                        <AnimeCard anime={anime} />
                                    </div>
                                ))
                            ) : (
                                <div className="w-full text-center py-8 text-gray-500">No top rated anime found</div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Recommended For You Section */}
                <RecommendedForYouSection />
            </div>

            {/* CTA Section */}
            {!isAuthenticated && (
                <section className="py-20 px-4 bg-gradient-to-t from-dark-100 to-dark border-t border-gray-800">
                    <div className="max-w-4xl mx-auto text-center">
                        <h2 className="text-2xl md:text-4xl font-bold text-white mb-4">
                            Start Tracking Your Journey
                        </h2>
                        <p className="text-gray-400 mb-8 max-w-xl mx-auto">
                            Join our community to list, rate, and review your favorite anime series.
                        </p>
                        <Link to="/register" className="btn-primary inline-flex items-center gap-2 group">
                            Create Free Account
                            <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </Link>
                    </div>
                </section>
            )}
        </div>
    );
}

function CurrentlyWatchingSection() {
    const { data: watching, isLoading } = useQuery({
        queryKey: ['user', 'list', 'watching'],
        queryFn: () => listApi.getAll({ status: 'Watching', sort: '-updated_at', limit: 6 }).then(res => res.data.results || res.data),
        retry: false
    });

    if (isLoading || !watching || watching.length === 0) return null;

    return (
        <section className="px-4 md:px-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4 md:mb-6">
                    <div className="flex items-center gap-2 md:gap-3">
                        <Play className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                        <h2 className="text-xl md:text-2xl font-bold text-white">Currently Watching</h2>
                    </div>
                    <Link to="/profile?tab=animelist&status=Watching" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
                        View All <ChevronRight className="w-4 h-4" />
                    </Link>
                </div>

                <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-4 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                    {watching.map((entry) => (
                        <div key={entry.id} className="min-w-[160px] md:min-w-0 snap-start h-full">
                            {/* Pass userListEntry explicitly to ensure progress tracking works */}
                            <AnimeCard
                                anime={entry.anime}
                                userListEntry={entry}
                                showProgress={true}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function RecommendedForYouSection() {
    const { isAuthenticated } = useAuth();
    
    const { data: recommendations, isLoading } = useQuery({
        queryKey: ['recommendations'],
        queryFn: () => recommendationsApi.getAll(12).then(res => res.data),
        enabled: isAuthenticated,
        retry: false,
        staleTime: 1000 * 60 * 60, // 1 hour
    });

    if (!isAuthenticated || isLoading || !recommendations || recommendations.length === 0) {
        return null;
    }

    // Generate subtitle based on most common genres in recommendations
    const genreCounts = {};
    recommendations.forEach(rec => {
        const genres = rec.reason_metadata?.matched_genres || [];
        genres.forEach(g => {
            genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
    });
    
    const topGenres = Object.entries(genreCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([genre]) => genre);
    
    const subtitle = topGenres.length > 0 
        ? `Based on your love for ${topGenres.join(', ')}` 
        : 'Curated just for you';

    return (
        <section className="px-4 md:px-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col gap-1 mb-4 md:mb-6">
                    <div className="flex items-center gap-2 md:gap-3">
                        <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-pink-500" />
                        <h2 className="text-xl md:text-2xl font-bold text-white">Recommended for You</h2>
                    </div>
                    <p className="text-sm text-gray-400 pl-1">{subtitle}</p>
                </div>

                <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-4 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                    {recommendations.map((rec) => (
                        <div key={rec.id} className="min-w-[160px] md:min-w-0 snap-start h-full">
                            <AnimeCard anime={rec.anime} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
