import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, TrendingUp, Star, ChevronRight, Sparkles, Plus, Check, Loader2 } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { animeApi, listApi, recommendationsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getImageUrl } from '../utils/imageUtils';

export default function Home() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [currentHeroIndex, setCurrentHeroIndex] = useState(0);
    const [heroListLoading, setHeroListLoading] = useState(false);
    const [locallyAddedIds, setLocallyAddedIds] = useState(new Set());
    const revealRefs = useRef([]);

    // Use useQueries for parallel fetching with proper stale times
    const { data: trending, isLoading: trendingLoading } = useQuery({
        queryKey: ['anime', 'trending'],
        queryFn: () => animeApi.getTrending().then(res => res.data),
        staleTime: 1000 * 60 * 15, // 15 minutes
        gcTime: 1000 * 60 * 30,
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        queryKey: ['anime', 'top_rated'],
        queryFn: () => animeApi.getTopRated().then(res => res.data),
        staleTime: 1000 * 60 * 15,
        gcTime: 1000 * 60 * 30,
    });

    // Hero Carousel Logic - optimized with useCallback
    useEffect(() => {
        if (!trending || trending.length === 0) return;
        const interval = setInterval(() => {
            setCurrentHeroIndex((prev) => (prev + 1) % Math.min(trending.length, 5));
        }, 8000);
        return () => clearInterval(interval);
    }, [trending]);

    const heroAnime = trending && trending.length > 0 ? trending[currentHeroIndex] : null;

    const isHeroInList = heroAnime && (
        !!heroAnime.user_list_status?.status ||
        locallyAddedIds.has(heroAnime.id)
    );

    const handleAddToList = useCallback(async () => {
        if (!isAuthenticated || !heroAnime || heroListLoading || isHeroInList) return;

        setHeroListLoading(true);
        try {
            await listApi.add({ anime_id: heroAnime.id, status: 'Plan to Watch' });
            setLocallyAddedIds(prev => new Set(prev).add(heroAnime.id));
            queryClient.invalidateQueries({ queryKey: ['anime'] });
            queryClient.invalidateQueries({ queryKey: ['lists'] });
        } catch (error) {
            if (error.response?.status === 400 || error.response?.status === 409) {
                setLocallyAddedIds(prev => new Set(prev).add(heroAnime.id));
            }
            console.error('Error adding to list:', error);
        } finally {
            setHeroListLoading(false);
        }
    }, [heroAnime, isAuthenticated, heroListLoading, isHeroInList, queryClient]);

    // Optimized IntersectionObserver with refs
    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '50px' });

        revealRefs.current.forEach(el => {
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, []);

    // Ref callback for reveal sections
    const setRevealRef = useCallback((el) => {
        if (el && !revealRefs.current.includes(el)) {
            revealRefs.current.push(el);
        }
    }, []);

    return (
        <div className="min-h-screen">
            {/* Hero Section */}
            <section className="relative h-[50vh] sm:h-[60vh] min-h-[400px] sm:min-h-[480px] flex items-center overflow-hidden">
                <div className="absolute inset-0 bg-dark">
                    {trending?.slice(0, 5).map((anime, index) => (
                        <div
                            key={anime.id}
                            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentHeroIndex ? 'opacity-70' : 'opacity-0'}`}
                        >
                            <img
                                src={getImageUrl(anime.banner_image || anime.cover_image)}
                                alt=""
                                loading={index === 0 ? 'eager' : 'lazy'}
                                className="w-full h-full object-cover scale-[1.02]"
                            />
                        </div>
                    ))}
                    <div className="absolute inset-0 bg-gradient-to-r from-dark via-dark/40 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/60 to-transparent h-full" />
                </div>

                <div className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-6">
                    {heroAnime && (
                        <div className="max-w-2xl animate-fade-in">
                            <div className="mb-3 sm:mb-6 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 border border-accent/40 backdrop-blur-md">
                                <span className="flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse"></span>
                                <span className="text-[10px] font-bold text-accent-light uppercase tracking-widest">Featured Series</span>
                            </div>

                            <h1 className="text-2xl sm:text-3xl md:text-5xl font-black mb-3 sm:mb-4 leading-tight text-white drop-shadow-lg max-w-3xl">
                                {heroAnime.title}
                            </h1>

                            <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4 sm:mb-6">
                                {heroAnime.rating && (
                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded-full">
                                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                                        <span className="text-sm font-bold text-yellow-500">{heroAnime.rating}</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-gray-100">
                                    <span className="text-xs font-bold uppercase">{heroAnime.anime_type}</span>
                                </div>
                                {(heroAnime.start_date || heroAnime.release_date) && (
                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-gray-100">
                                        <span className="text-xs font-bold">{new Date(heroAnime.start_date || heroAnime.release_date).getFullYear()}</span>
                                    </div>
                                )}
                                {heroAnime.genres?.slice(0, 3).map(genre => (
                                    <div key={genre.id} className="flex items-center gap-1.5 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-accent-light">
                                        <span className="text-[10px] font-bold uppercase tracking-wider">{genre.name}</span>
                                    </div>
                                ))}
                            </div>

                            <p className="text-sm sm:text-base md:text-lg text-gray-200 mb-6 sm:mb-8 max-w-lg line-clamp-2 sm:line-clamp-3 drop-shadow-md font-medium leading-relaxed">
                                {heroAnime.synopsis}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                <Link
                                    to={`/anime/${heroAnime.slug}`}
                                    className="btn-primary flex items-center gap-2 py-2 px-4 sm:py-2.5 sm:px-6 font-bold text-sm sm:text-base"
                                >
                                    <Play className="w-4 h-4 fill-current" />
                                    View Series
                                </Link>
                                {isAuthenticated && (
                                    <button
                                        onClick={handleAddToList}
                                        disabled={heroListLoading || isHeroInList}
                                        className={`flex items-center gap-2 px-6 py-2.5 border rounded-xl font-bold transition-colors ${isHeroInList
                                            ? 'bg-green-500/20 border-green-500/40 text-green-400 cursor-default'
                                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                                            }`}
                                    >
                                        {heroListLoading ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : isHeroInList ? (
                                            <Check className="w-4 h-4" />
                                        ) : (
                                            <Plus className="w-4 h-4" />
                                        )}
                                        {isHeroInList ? 'In Your List' : 'Add to List'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* Main Content Area */}
            <div className="relative">
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.02)_0%,transparent_50%)]" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_100%,rgba(255,255,255,0.01)_0%,transparent_50%)]" />
                </div>

                <div className="relative space-y-8 md:space-y-16 py-8 md:py-12 mt-8 md:mt-12 z-20">
                    {isAuthenticated && <CurrentlyWatchingSection />}

                    {/* Trending Section */}
                    <section ref={setRevealRef} className="px-4 md:px-6 reveal pb-2">
                        <div className="max-w-7xl mx-auto">
                            <div className="flex items-center justify-between mb-6 md:mb-8">
                                <div className="flex items-center gap-3 md:gap-4">
                                    <div className="p-2.5 rounded-xl bg-accent/10 border border-accent/20">
                                        <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-accent icon-glow-accent" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl md:text-3xl font-bold text-white tracking-tight">Trending Now</h2>
                                        <p className="text-xs md:text-sm text-gray-500 mt-0.5">Most discussed this week</p>
                                    </div>
                                </div>
                                <Link to="/browse?sort=trending" className="btn-secondary py-1.5 px-4 text-xs flex items-center gap-2 hover:border-accent/40 group">
                                    View All <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                                </Link>
                            </div>

                            <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-3 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
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
                    <section ref={setRevealRef} className="px-4 md:px-6 reveal pb-2">
                        <div className="max-w-7xl mx-auto">
                            <div className="flex items-center justify-between mb-6 md:mb-8">
                                <div className="flex items-center gap-3 md:gap-4">
                                    <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20">
                                        <Star className="w-5 h-5 md:w-6 md:h-6 text-yellow-400 icon-glow-gold" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl md:text-3xl font-bold text-white tracking-tight">Top Rated</h2>
                                        <p className="text-xs md:text-sm text-gray-500 mt-0.5">Highest rated by community</p>
                                    </div>
                                </div>
                                <Link to="/browse?sort=rating" className="btn-secondary py-1.5 px-4 text-xs flex items-center gap-2 hover:border-yellow-400/40 group">
                                    View All <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                                </Link>
                            </div>

                            <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-3 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
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
                    <RecommendedForYouSection revealRef={setRevealRef} />
                </div>

                {/* CTA Section */}
                {!isAuthenticated && (
                    <section ref={setRevealRef} className="py-16 sm:py-24 px-4 bg-dark relative overflow-hidden border-t border-gray-800 reveal">
                        <div className="absolute inset-0 bg-accent/5 blur-[100px] pointer-events-none" />
                        <div className="max-w-4xl mx-auto text-center relative z-10 glass border-white/5 py-10 sm:py-16 px-4 sm:px-8 rounded-2xl sm:rounded-3xl">
                            <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold text-white mb-4 sm:mb-6 tracking-tight">
                                Start Tracking Your Journey
                            </h2>
                            <p className="text-gray-400 mb-6 sm:mb-10 text-base sm:text-lg max-w-2xl mx-auto px-2">
                                Join over <span className="text-white font-semibold">10,000+</span> anime fans listing, rating, and reviewing their favorite series.
                            </p>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
                                <Link to="/register" className="btn-primary flex items-center gap-2 group text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4 w-full sm:w-auto justify-center">
                                    Create Free Account
                                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:translate-x-1" />
                                </Link>
                                <span className="text-gray-500 text-xs sm:text-sm">No credit card required</span>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

function CurrentlyWatchingSection() {
    const { data: watching, isLoading } = useQuery({
        queryKey: ['user', 'list', 'watching'],
        queryFn: () => listApi.getAll({ status: 'Watching', sort: '-updated_at', limit: 6 }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 2,
        retry: false,
        enabled: typeof window !== 'undefined',
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

                <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-3 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                    {watching.map((entry) => (
                        <div key={entry.id} className="min-w-[160px] md:min-w-0 snap-start h-full">
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

function RecommendedForYouSection({ revealRef }) {
    const { isAuthenticated } = useAuth();

    const { data: recommendations, isLoading, error } = useQuery({
        queryKey: ['recommendations'],
        queryFn: () => recommendationsApi.getAll(12).then(res => res.data.results || res.data),
        enabled: isAuthenticated,
        staleTime: 1000 * 60 * 60,
        retry: 1,
    });

    if (!isAuthenticated) {
        return null;
    }

    if (isLoading) {
        return (
            <section ref={revealRef} className="px-4 md:px-6 reveal">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col gap-1 mb-4 md:mb-6">
                        <div className="flex items-center gap-2 md:gap-3">
                            <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-pink-500" />
                            <h2 className="text-xl md:text-2xl font-bold text-white">Recommended for You</h2>
                        </div>
                        <p className="text-sm text-gray-400 pl-1">Loading recommendations...</p>
                    </div>
                    <div className="flex overflow-x-auto pb-4 gap-4 md:grid md:grid-cols-3 lg:grid-cols-6 md:gap-6 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                        {Array(6).fill(0).map((_, i) => (
                            <div key={i} className="min-w-[160px] md:min-w-0">
                                <AnimeCardSkeleton />
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        );
    }

    if (error) {
        console.error('Recommendations error:', error);
    }

    if (!recommendations || recommendations.length === 0) {
        return null;
    }

    const genreCounts = {};
    recommendations.forEach(rec => {
        const genres = rec.reason_metadata?.matched_genres || [];
        genres.forEach(g => {
            genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
    });

    const topGenres = Object.entries(genreCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([genre]) => genre);

    const subtitle = topGenres.length > 0
        ? `Based on your love for ${topGenres.join(', ')}`
        : 'Curated just for you';

    return (
        <section ref={revealRef} className="px-4 md:px-6 reveal">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col gap-1 mb-4 md:mb-6">
                    <div className="flex items-center gap-2 md:gap-3">
                        <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-pink-500" />
                        <h2 className="text-xl md:text-2xl font-bold text-white">Recommended for You</h2>
                    </div>
                    <p className="text-sm text-gray-400 pl-1">{subtitle}</p>
                </div>

                <div className="flex overflow-x-auto pb-4 snap-x snap-mandatory gap-4 md:grid md:grid-cols-3 lg:grid-cols-6 md:gap-6 md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
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
