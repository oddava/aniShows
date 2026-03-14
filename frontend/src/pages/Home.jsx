import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, TrendingUp, Star, ChevronRight, Sparkles, Plus, Check, Loader2 } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { animeApi, listApi, recommendationsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getImageUrl, getImageSrcSet } from '../utils/imageUtils';
import logger from '../utils/logger';
import SEO from '../components/SEO';

export default function Home() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [currentHeroIndex, setCurrentHeroIndex] = useState(0);
    const [heroListLoading, setHeroListLoading] = useState(false);
    const [locallyAddedIds, setLocallyAddedIds] = useState(new Set());
    const revealRefs = useRef([]);
    const observer = useRef(null);

    // Critical: Load trending immediately for hero section
    const { data: trending, isLoading: trendingLoading } = useQuery({
        queryKey: ['anime', 'trending'],
        queryFn: () => animeApi.getTrending().then(res => res.data),
        staleTime: 1000 * 60 * 15, // 15 minutes
        gcTime: 1000 * 60 * 30,
        priority: 'high', // Load this first
    });

    // Non-critical: Defer top rated to reduce initial load
    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        queryKey: ['anime', 'top_rated'],
        queryFn: () => animeApi.getTopRated().then(res => res.data),
        staleTime: 1000 * 60 * 15,
        gcTime: 1000 * 60 * 30,
        enabled: !trendingLoading, // Only load after trending is loaded
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
            logger.error('Error adding to list:', error);
        } finally {
            setHeroListLoading(false);
        }
    }, [heroAnime, isAuthenticated, heroListLoading, isHeroInList, queryClient]);

    // Optimized IntersectionObserver with refs
    useEffect(() => {
        observer.current = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    observer.current?.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '50px' });

        // Observe elements that were registered before the observer was ready
        revealRefs.current.forEach(el => {
            if (el) observer.current.observe(el);
        });
        revealRefs.current = []; // Clear the buffer

        return () => {
            if (observer.current) {
                observer.current.disconnect();
                observer.current = null;
            }
        };
    }, []);

    // Ref callback for reveal sections - handles both initial and dynamic elements
    const setRevealRef = useCallback((el) => {
        if (!el) return;

        if (observer.current) {
            observer.current.observe(el);
        } else {
            // Buffer the element if the observer isn't ready yet
            if (!revealRefs.current.includes(el)) {
                revealRefs.current.push(el);
            }
        }
    }, []);

    return (
        <>
            <SEO page="home" />
            <div className="min-h-screen home-page">
                {/* Hero Section */}
                <section className="relative h-[55vh] sm:h-[65vh] min-h-[450px] sm:min-h-[550px] flex items-center overflow-hidden">
                    <div className="absolute inset-0 bg-dark">
                        {trending?.slice(0, 5).map((anime, index) => (
                            <div
                                key={anime.id}
                                className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentHeroIndex ? 'opacity-100' : 'opacity-0'}`}
                            >
                                <img
                                    src={getImageUrl(anime.banner_image || anime.cover_image)}
                                    srcSet={getImageSrcSet(anime, 'banner')}
                                    sizes="100vw"
                                    alt={`${anime.title} banner image`}
                                    loading={index === 0 ? 'eager' : 'lazy'}
                                    className="w-full h-full object-cover "
                                />
                            </div>
                        ))}
                        <div className="absolute inset-0 bg-dark/80" />
                        <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/80 to-transparent h-full" />
                    </div>

                    <div className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-6 mt-12 sm:mt-16">
                        {heroAnime && (
                            <div className="max-w-2xl">
                                <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold mb-3 leading-tight text-white/90  tracking-tight">
                                    {heroAnime.title}
                                </h1>

                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm sm:text-base font-medium text-gray-300 mb-4 sm:mb-5 ">
                                    {heroAnime.rating && (
                                        <span className="flex items-center gap-1.5 text-yellow-400 font-bold">
                                            <Star className="w-4 h-4 fill-current" />
                                            {heroAnime.rating}
                                        </span>
                                    )}
                                    {heroAnime.rating && <span className="text-gray-600">•</span>}
                                    <span className="text-gray-100 uppercase tracking-widest text-[11px] sm:text-xs font-bold">{heroAnime.anime_type}</span>
                                    {(heroAnime.start_date || heroAnime.release_date) && (
                                        <>
                                            <span className="text-gray-600">•</span>
                                            <span className="text-gray-200">{new Date(heroAnime.start_date || heroAnime.release_date).getFullYear()}</span>
                                        </>
                                    )}
                                    {heroAnime.genres?.length > 0 && (
                                        <>
                                            <span className="text-gray-600">•</span>
                                            <span className="text-gray-400 line-clamp-1">{heroAnime.genres.slice(0, 3).map(g => g.name).join(', ')}</span>
                                        </>
                                    )}
                                </div>

                                <p className="text-sm sm:text-base md:text-lg text-gray-300 mb-6 sm:mb-8 max-w-2xl line-clamp-2 md:line-clamp-3 font-normal leading-relaxed ">
                                    {heroAnime.synopsis}
                                </p>

                                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                                    <Link
                                        to={`/anime/${heroAnime.slug}`}
                                        className="btn-primary min-w-[140px] rounded-lg px-6 py-2.5 text-sm sm:px-8 sm:py-3 sm:text-base"
                                    >
                                        <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                                        Play Now
                                    </Link>
                                    {isAuthenticated && (
                                        <button
                                            onClick={handleAddToList}
                                            disabled={heroListLoading || isHeroInList}
                                            className={`flex min-w-[140px] items-center justify-center gap-2 rounded-lg border px-6 py-2.5 text-sm font-bold sm:px-8 sm:py-3 sm:text-base ${isHeroInList
                                                ? 'cursor-default border-gray-700 bg-dark-100 text-white'
                                                : 'border-gray-700 bg-dark-100 text-white transition-colors hover:bg-dark-50'
                                                }`}
                                        >
                                            {heroListLoading ? (
                                                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                                            ) : isHeroInList ? (
                                                <Check className="w-4 h-4 sm:w-5 sm:h-5" />
                                            ) : (
                                                <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                                            )}
                                            {isHeroInList ? 'In List' : 'Add to List'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Main Content Area */}
                <div className="relative">
                    <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-dark/80 to-transparent pointer-events-none z-10" />
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
                                    <div>
                                        <h2 className="text-xl md:text-2xl font-bold text-white/90 tracking-tight">Trending Now</h2>
                                        <p className="text-xs md:text-sm text-gray-500 mt-0.5">Most discussed this week</p>
                                    </div>
                                    <Link to="/browse?sort=trending" className="btn-secondary py-1.5 px-4 text-xs flex items-center gap-2 hover:border-accent/40 group">
                                        View All
                                    </Link>
                                </div>

                                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-4 md:pb-0 touch-pan-x touch-pan-y overscroll-x-contain">
                                    {trendingLoading ? (
                                        Array(6).fill(0).map((_, i) => (
                                            <div key={i} className="flex-shrink-0 w-[160px] md:w-auto h-full">
                                                <AnimeCardSkeleton />
                                            </div>
                                        ))
                                    ) : trending?.length > 0 ? (
                                        trending.slice(0, 6).map((anime, index) => (
                                            <div key={anime.id} className="flex-shrink-0 w-[160px] md:w-auto h-full">
                                                <AnimeCard anime={anime} />
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
                                    <div>
                                        <h2 className="text-xl md:text-2xl font-bold text-white/90 tracking-tight">Top Rated</h2>
                                        <p className="text-xs md:text-sm text-gray-500 mt-0.5">Highest rated by community</p>
                                    </div>
                                    <Link to="/browse?sort=rating" className="btn-secondary py-1.5 px-4 text-xs flex items-center gap-2 hover:border-yellow-400/40 group">
                                        View All <ChevronRight className="w-4 h-4" />
                                    </Link>
                                </div>

                                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-4 md:pb-0 touch-pan-x touch-pan-y overscroll-x-contain">
                                    {topRatedLoading ? (
                                        Array(6).fill(0).map((_, i) => (
                                            <div key={i} className="flex-shrink-0 w-[160px] md:w-auto h-full">
                                                <AnimeCardSkeleton />
                                            </div>
                                        ))
                                    ) : topRated?.length > 0 ? (
                                        topRated.slice(0, 6).map((anime) => (
                                            <div key={anime.id} className="flex-shrink-0 w-[160px] md:w-auto h-full">
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
                            <div className="max-w-4xl mx-auto text-center relative z-10 ui-surface py-10 sm:py-16 px-4 sm:px-8 rounded-2xl sm:rounded-3xl">
                                <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white/90 mb-4 tracking-tight">
                                    Start Tracking Your Journey
                                </h2>
                                <p className="text-gray-400 mb-6 sm:mb-10 text-base sm:text-lg max-w-2xl mx-auto px-2">
                                    Join over <span className="text-white font-semibold">10,000+</span> anime fans listing, rating, and reviewing their favorite series.
                                </p>
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
                                    <Link to="/register" className="btn-primary flex items-center gap-2 text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4 w-full sm:w-auto justify-center">
                                        Create Free Account
                                        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                                    </Link>
                                    <span className="text-gray-500 text-xs sm:text-sm">No credit card required</span>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </>
    );
}

function CurrentlyWatchingSection() {
    const { isAuthenticated } = useAuth();

    const { data: watching, isLoading } = useQuery({
        queryKey: ['user', 'list', 'watching'],
        queryFn: () => listApi.getAll({ status: 'Watching', sort: '-updated_at', limit: 6 }).then(res => res.data.results || res.data),
        staleTime: 1000 * 60 * 2,
        retry: false,
        enabled: isAuthenticated, // Only fetch if authenticated
    });

    if (isLoading || !watching || watching.length === 0) return null;

    return (
        <section className="px-4 md:px-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4 md:mb-6">
                    <div>
                        <h2 className="text-xl md:text-2xl font-bold text-white/90 tracking-tight">Currently Watching</h2>
                    </div>
                    <Link to="/profile?tab=animelist&status=Watching" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
                        View All <ChevronRight className="w-4 h-4" />
                    </Link>
                </div>

                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-4 md:pb-0 touch-pan-x touch-pan-y overscroll-x-contain">
                    {watching.map((entry) => (
                        <div key={entry.id} className="flex-shrink-0 w-[160px] md:w-auto h-full">
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

    if (!isAuthenticated || (error && !isLoading) || (!isLoading && (!recommendations || recommendations.length === 0))) {
        return null;
    }

    const genreCounts = {};
    if (recommendations) {
        recommendations.forEach(rec => {
            const genres = rec.reason_metadata?.matched_genres || [];
            genres.forEach(g => {
                genreCounts[g] = (genreCounts[g] || 0) + 1;
            });
        });
    }

    const topGenres = Object.entries(genreCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([genre]) => genre);

    const subtitle = isLoading
        ? 'Loading recommendations...'
        : (topGenres.length > 0
            ? `Based on your love for ${topGenres.join(', ')}`
            : 'Curated just for you');

    return (
        <section ref={revealRef} className="px-4 md:px-6 reveal">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col gap-1 mb-4 md:mb-6">
                    <div>
                        <h2 className="text-xl md:text-2xl font-bold text-white/90 tracking-tight">Recommended for You</h2>
                    </div>
                    <p className="text-sm md:text-base text-gray-500 mt-0.5">{subtitle}</p>
                </div>

                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-4 md:pb-0 touch-pan-x touch-pan-y overscroll-x-contain">
                    {isLoading ? (
                        Array(6).fill(0).map((_, i) => (
                            <div key={i} className="flex-shrink-0 w-[160px] md:w-auto h-full">
                                <AnimeCardSkeleton />
                            </div>
                        ))
                    ) : (
                        recommendations?.map((rec) => (
                            <div key={rec.id} className="flex-shrink-0 w-[160px] md:w-auto h-full">
                                <AnimeCard anime={rec.anime} />
                            </div>
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}
