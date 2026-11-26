import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, Download, X } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { useAuth } from '../context/AuthContext';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import logger from '../utils/logger';
import SEO from '../components/SEO';
import SectionHeader from '../components/common/SectionHeader';
import ErrorState from '../components/common/ErrorState';
import GuestLanding from '../components/home/GuestLanding';
import ContinueSection from '../components/home/ContinueSection';
import AiringRibbon from '../components/home/AiringRibbon';
import RankedList from '../components/home/RankedList';
import { animeQueries } from '../api/queries/anime';
import { hasSession } from '../api/httpClient';
import { recommendationMutations, recommendationQueries } from '../api/queries/recommendations';

export default function Home() {
    const { isAuthenticated, loading: authLoading } = useAuth();
    // A returning member's session is restored after the first paint. Until
    // then the page already has the member layout (its skeletons), so nothing
    // is inserted above the shelves when it lands and the guest landing never
    // flashes; the queries that need the member wait for the session.
    const restoring = authLoading && hasSession();
    const memberView = isAuthenticated || restoring;
    const revealRefs = useRef([]);
    const observer = useRef(null);

    const {
        data: trending,
        isLoading: trendingLoading,
        isError: trendingError,
        refetch: refetchTrending,
    } = useQuery({
        ...animeQueries.trending(isAuthenticated ? 'member-home' : 'guest-home'),
        enabled: !restoring,
        staleTime: 1000 * 60 * 15,
        gcTime: 1000 * 60 * 30,
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        ...animeQueries.topRated(),
        staleTime: 1000 * 60 * 30,
        gcTime: 1000 * 60 * 60,
        retry: false,
    });

    // Shelves never repeat each other: each skips what's already shown above
    // it, and Trending stays away while "Recommended" is still the popularity
    // fallback (it would be the same six shows).
    const { data: recommendations } = useQuery({
        ...recommendationQueries.all(12),
        enabled: isAuthenticated,
        staleTime: 1000 * 60 * 60,
        retry: 1,
    });
    const shelves = useMemo(() => {
        const shown = new Set((recommendations || []).slice(0, 6).map((rec) => rec.anime?.id));
        const recsAreFallback = Boolean(recommendations?.length) && recommendations.every((rec) => rec.reason === 'trending');
        const trendingItems = recsAreFallback ? [] : (trending || []).filter((anime) => !shown.has(anime.id)).slice(0, 6);
        trendingItems.forEach((anime) => shown.add(anime.id));
        const topRatedItems = (topRated || []).filter((anime) => !shown.has(anime.id)).slice(0, 6);
        return {
            trending: trendingItems,
            hideTrending: isAuthenticated && recsAreFallback,
            topRated: topRatedItems.length >= 6 ? topRatedItems : [],
        };
    }, [isAuthenticated, recommendations, trending, topRated]);

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
                {!memberView && <GuestLanding />}

                {/* Main Content Area */}
                <div className="relative space-y-14 md:space-y-20 pb-16 md:pb-24">
                    {memberView && <ContinueSection />}
                    {/* The shelves wait for the session (they depend on it);
                        a screen of space holds their place meanwhile. */}
                    {restoring ? <div aria-hidden="true" className="min-h-[100dvh]" /> : isAuthenticated ? (
                    <>
                    <AiringRibbon />

                    <RecommendedForYouSection revealRef={setRevealRef} />

                    {/* Members: the charts as two numbered lists side by
                        side, after the poster shelf of their own picks. */}
                    <div
                        ref={setRevealRef}
                        className={`reveal page-container grid gap-5 ${!shelves.hideTrending && (topRatedLoading || shelves.topRated.length > 0) ? 'lg:grid-cols-2' : ''}`}
                    >
                        {!shelves.hideTrending && (
                            <RankedList
                                id="chart-trending"
                                title="Trending now"
                                viewAllTo="/browse?sort=trending"
                                items={shelves.trending}
                                isLoading={trendingLoading}
                                isError={trendingError}
                                onRetry={refetchTrending}
                            />
                        )}
                        <RankedList
                            id="chart-top-rated"
                            title="Top rated"
                            viewAllTo="/browse?sort=rating"
                            items={shelves.topRated}
                            isLoading={topRatedLoading}
                        />
                    </div>
                    </>
                    ) : (
                    <>
                    <AiringRibbon everyone />

                    {/* Below the landing's featured banner (the page's largest
                        paint): these posters load as they near the screen, so
                        they do not compete with it for bandwidth (RA-002). */}
                    <AnimeShelf
                        revealRef={setRevealRef}
                        title="Trending now"
                        viewAllTo="/browse?sort=trending"
                        items={shelves.trending}
                        isLoading={trendingLoading}
                        isError={trendingError}
                        onRetry={refetchTrending}
                        emptyText="No trending anime right now."
                        eager={false}
                    />

                    <AnimeShelf
                        revealRef={setRevealRef}
                        title="Top rated"
                        viewAllTo="/browse?sort=rating"
                        items={shelves.topRated}
                        isLoading={topRatedLoading}
                        hideWhenEmpty
                        eager={false}
                    />
                    </>
                    )}
                </div>

            </div>
        </>
    );
}

// Six posters: a swipeable row on phones, a grid from md up.
const SHELF_ROW_CLASSES = 'flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5 md:gap-6 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0 snap-x snap-mandatory md:snap-none scroll-px-4 overscroll-x-contain';
const SHELF_ITEM_CLASSES = 'flex-shrink-0 w-[42vw] max-w-[180px] xs:w-[160px] md:w-auto md:max-w-none h-full snap-start';

function AnimeShelf({ revealRef, title, subtitle, viewAllTo, items, isLoading, isError = false, onRetry, emptyText, hideWhenEmpty = false, renderItem, eager = true }) {
    const headingId = `shelf-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (!isLoading && !isError && hideWhenEmpty && !(items?.length > 0)) return null;

    return (
        <section ref={revealRef} aria-labelledby={headingId} className={`px-4 md:px-6 ${revealRef ? 'reveal' : ''}`}>
            <div className="max-w-7xl mx-auto">
                <SectionHeader id={headingId} title={title} subtitle={subtitle} viewAllTo={viewAllTo} />
                {isError && !isLoading ? (
                    <ErrorState
                        title={`Couldn’t load ${title.toLowerCase()}`}
                        message="This shelf didn’t load. The rest of the page is fine."
                        onRetry={onRetry}
                    />
                ) : (
                <div className={SHELF_ROW_CLASSES}>
                    {isLoading ? (
                        Array.from({ length: 6 }, (_, i) => (
                            <div key={`sk-${i}`} className={SHELF_ITEM_CLASSES} aria-hidden="true">
                                <AnimeCardSkeleton />
                            </div>
                        ))
                    ) : items?.length > 0 ? (
                        items.map((item, index) => (
                            <div key={item.id} className={SHELF_ITEM_CLASSES}>
                                {renderItem ? renderItem(item, index) : <AnimeCard anime={item} index={index} showMeta eagerFirstSix={eager} />}
                            </div>
                        ))
                    ) : (
                        <p className="w-full text-center py-8 text-sm text-gray-500">{emptyText}</p>
                    )}
                </div>
                )}
            </div>
        </section>
    );
}

function getRecommendationsSubtitle(recommendations) {
    // Users without personal picks yet get generic trending items from the
    // backend; those say nothing about the user's taste.
    const personal = recommendations.filter((rec) => rec.reason !== 'trending');
    if (personal.length === 0) return 'Popular right now while we learn your taste';

    const genreCounts = {};
    personal.forEach((rec) => {
        (rec.reason_metadata?.matched_genres || []).forEach((genre) => {
            genreCounts[genre] = (genreCounts[genre] || 0) + 1;
        });
    });
    const topGenres = Object.entries(genreCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([genre]) => genre);

    return topGenres.length > 0
        ? `Based on your love for ${topGenres.join(', ')}`
        : 'Curated just for you';
}

function RecommendedForYouSection({ revealRef }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    const { data: recommendations, isLoading, error } = useQuery({
        ...recommendationQueries.all(12),
        enabled: isAuthenticated,
        staleTime: 1000 * 60 * 60,
        refetchInterval: 1000 * 60 * 60,
        retry: 1,
    });

    const { mutate: dismissRecommendation } = useMutation(recommendationMutations.dismiss(queryClient));

    // Move focus to a neighbouring card's button before this card leaves, so
    // keyboard users don't drop back to the top of the page.
    const handleDismiss = useCallback((event, animeId) => {
        const buttons = Array.from(
            event.currentTarget.closest('section')?.querySelectorAll('[data-rec-dismiss]') || []
        );
        const position = buttons.indexOf(event.currentTarget);
        const neighbour = buttons[position + 1] || buttons[position - 1];
        neighbour?.focus();
        dismissRecommendation(animeId, {
            onError: (dismissError) => logger.error('Error dismissing recommendation:', dismissError),
        });
    }, [dismissRecommendation]);

    if (!isAuthenticated || (error && !isLoading) || (!isLoading && (!recommendations || recommendations.length === 0))) {
        return null;
    }

    const subtitle = isLoading ? 'Finding picks for you…' : getRecommendationsSubtitle(recommendations);

    return (
        <AnimeShelf
            revealRef={revealRef}
            title="Recommended for you"
            subtitle={subtitle}
            items={recommendations?.slice(0, 6)}
            isLoading={isLoading}
            renderItem={(rec, index) => (
                <div className="relative h-full group/rec">
                    <AnimeCard anime={rec.anime} index={index} showMeta />
                    <button
                        type="button"
                        data-rec-dismiss
                        onClick={(event) => handleDismiss(event, rec.anime.id)}
                        aria-label={`Not interested in ${rec.anime.title}`}
                        title="Not interested"
                        className="absolute top-2 right-2 z-[200] w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-md sm:rounded-lg bg-[rgb(27_31_37/0.88)] backdrop-blur-sm text-white hover:bg-[rgb(44_50_59/0.94)] press opacity-0 group-hover/rec:opacity-100 group-focus-within/rec:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 touch-manipulation after:absolute after:-inset-2 sm:after:inset-0 after:content-['']"
                    >
                        <X aria-hidden="true" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                </div>
            )}
        />
    );
}
