import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, TrendingUp, Star, ChevronRight } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { animeApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Home() {
    const { isAuthenticated } = useAuth();

    const { data: trending, isLoading: trendingLoading } = useQuery({
        queryKey: ['anime', 'trending'],
        queryFn: () => animeApi.getTrending().then(res => res.data),
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        queryKey: ['anime', 'top_rated'],
        queryFn: () => animeApi.getTopRated().then(res => res.data),
    });

    return (
        <div className="min-h-screen">
            {/* Hero Section */}
            <section className="relative h-[70vh] min-h-[500px] flex items-center justify-center overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-dark to-dark" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/30 via-transparent to-transparent" />

                {/* Content */}
                <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
                    <h1 className="text-5xl md:text-7xl font-bold mb-6">
                        <span className="text-gradient">Discover</span> Your Next
                        <br />
                        <span className="text-white">Anime Adventure</span>
                    </h1>
                    <p className="text-lg md:text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
                        Explore thousands of anime series, track your favorites, and join a community of passionate fans.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <Link to="/browse" className="btn-primary flex items-center gap-2">
                            <Play className="w-5 h-5" />
                            Start Exploring
                        </Link>
                        {!isAuthenticated && (
                            <Link to="/register" className="btn-secondary flex items-center gap-2">
                                Create Account
                            </Link>
                        )}
                    </div>
                </div>

                {/* Fade to content */}
                <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-dark to-transparent" />
            </section>

            {/* Trending Section */}
            <section className="py-16 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                            <TrendingUp className="w-6 h-6 text-accent" />
                            <h2 className="text-2xl md:text-3xl font-bold text-white">Trending Now</h2>
                        </div>
                        <Link to="/browse?sort=popular" className="flex items-center gap-1 text-accent hover:text-accent-light transition-colors">
                            View All <ChevronRight className="w-4 h-4" />
                        </Link>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-6">
                        {trendingLoading ? (
                            Array(6).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)
                        ) : trending?.length > 0 ? (
                            trending.slice(0, 6).map((anime) => (
                                <AnimeCard key={anime.id} anime={anime} />
                            ))
                        ) : (
                            <div className="col-span-full text-center py-8 text-gray-500">No trending anime found</div>
                        )}
                    </div>
                </div>
            </section>

            {/* Top Rated Section */}
            <section className="py-16 px-4 bg-dark-100">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                            <Star className="w-6 h-6 text-yellow-400" />
                            <h2 className="text-2xl md:text-3xl font-bold text-white">Top Rated</h2>
                        </div>
                        <Link to="/browse?sort=rating" className="flex items-center gap-1 text-accent hover:text-accent-light transition-colors">
                            View All <ChevronRight className="w-4 h-4" />
                        </Link>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-6">
                        {topRatedLoading ? (
                            Array(6).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)
                        ) : topRated?.length > 0 ? (
                            topRated.slice(0, 6).map((anime) => (
                                <AnimeCard key={anime.id} anime={anime} />
                            ))
                        ) : (
                            <div className="col-span-full text-center py-8 text-gray-500">No top rated anime found</div>
                        )}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            {!isAuthenticated && (
                <section className="py-24 px-4">
                    <div className="max-w-4xl mx-auto text-center">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
                            Ready to start your anime journey?
                        </h2>
                        <p className="text-gray-400 mb-8 max-w-xl mx-auto">
                            Create a free account to track anime, build your watchlist, and discover new favorites.
                        </p>
                        <Link to="/register" className="btn-primary">
                            Get Started Free
                        </Link>
                    </div>
                </section>
            )}
        </div>
    );
}
