import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, Download, X } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { useAuth } from '../context/AuthContext';
import { useCallback, useEffect, useRef } from 'react';
import logger from '../utils/logger';
import SEO from '../components/SEO';
import SectionHeader from '../components/common/SectionHeader';
import ErrorState from '../components/common/ErrorState';
import HeroSearch from '../components/home/HeroSearch';
import ContinueSection from '../components/home/ContinueSection';
import AiringRibbon from '../components/home/AiringRibbon';
import { animeQueries } from '../api/queries/anime';
import { recommendationMutations, recommendationQueries } from '../api/queries/recommendations';

export default function Home() {
    const { isAuthenticated } = useAuth();
    const revealRefs = useRef([]);
    const observer = useRef(null);

    const {
        data: trending,
        isLoading: trendingLoading,
        isError: trendingError,
        refetch: refetchTrending,
    } = useQuery({
        ...animeQueries.trending(isAuthenticated ? 'member-home' : 'guest-home'),
        staleTime: 1000 * 60 * 15,
        gcTime: 1000 * 60 * 30,
    });

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        ...animeQueries.topRated(),
        staleTime: 1000 * 60 * 30,
        gcTime: 1000 * 60 * 60,
        retry: false,
    });

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
                {isAuthenticated ? (
                    <MemberHeader />
                ) : (
                    <GuestIntroHero showAuthLinks />
                )}

                {/* Main Content Area */}
                <div className={`relative space-y-12 md:space-y-16 pb-10 md:pb-14 ${isAuthenticated ? 'pt-2' : 'pt-6 md:pt-14'}`}>
                    {isAuthenticated && <ContinueSection />}
                    {isAuthenticated && <AiringRibbon />}

                    {/* Recommended For You Section */}
                    <RecommendedForYouSection revealRef={setRevealRef} />

                    <AnimeShelf
                        revealRef={setRevealRef}
                        title="Trending Now"
                        viewAllTo="/browse?sort=trending"
                        items={trending?.slice(0, 6)}
                        isLoading={trendingLoading}
                        isError={trendingError}
                        onRetry={refetchTrending}
                        emptyText="No trending anime right now."
                    />

                    <AnimeShelf
                        revealRef={setRevealRef}
                        title="Top Rated"
                        viewAllTo="/browse?sort=rating"
                        items={topRated?.slice(0, 6)}
                        isLoading={topRatedLoading}
                        hideWhenEmpty
                    />
                </div>

                {/* CTA Section */}
                {!isAuthenticated && (
                    <section ref={setRevealRef} className="px-4 md:px-6 pb-16 sm:pb-24 reveal">
                        <div className="max-w-3xl mx-auto text-center ui-surface py-10 sm:py-14 px-5 sm:px-10">
                            <h2 className="section-title mb-4">
                                Start Tracking Your Journey
                            </h2>
                            <p className="text-gray-400 mb-7 sm:mb-8 text-base sm:text-lg max-w-xl mx-auto">
                                Keep a list of what you&rsquo;re watching, rate what you finish, and get picks based on what you actually like.
                            </p>
                            <Link to="/register" className="btn-primary px-6 sm:px-7 py-3 w-full sm:w-auto">
                                Create Free Account
                                <ChevronRight aria-hidden="true" className="w-4 h-4" />
                            </Link>
                        </div>
                    </section>
                )}
            </div>
        </>
    );
}

// Six posters: a swipeable row on phones, a grid from md up.
const SHELF_ROW_CLASSES = 'flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5 md:gap-6 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0 snap-x snap-mandatory md:snap-none scroll-px-4 overscroll-x-contain';
const SHELF_ITEM_CLASSES = 'flex-shrink-0 w-[42vw] max-w-[180px] xs:w-[160px] md:w-auto md:max-w-none h-full snap-start';

function AnimeShelf({ revealRef, title, subtitle, viewAllTo, items, isLoading, isError = false, onRetry, emptyText, hideWhenEmpty = false, renderItem }) {
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
                            <div key={i} className={SHELF_ITEM_CLASSES} aria-hidden="true">
                                <AnimeCardSkeleton />
                            </div>
                        ))
                    ) : items?.length > 0 ? (
                        items.map((item, index) => (
                            <div key={item.id} className={SHELF_ITEM_CLASSES}>
                                {renderItem ? renderItem(item, index) : <AnimeCard anime={item} index={index} showMeta />}
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

/** Signed in: today's date and the promise; the page is about tonight. */
function MemberHeader() {
    const { user } = useAuth();
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    return (
        <header className="px-4 md:px-6 pt-20 md:pt-28 pb-6">
            <div className="max-w-7xl mx-auto">
                <p className="flex items-center gap-2 text-sm text-gray-400">
                    <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-[var(--signature)]" />
                    {today}
                </p>
                <h1 className="page-title mt-2">
                    {user?.username ? `Welcome back, ${user.username}` : 'Welcome back'}
                </h1>
            </div>
        </header>
    );
}

function GuestIntroHero({ showAuthLinks = true }) {
    const formRef = useRef(null);

    // While this search field is on screen, the navbar's search pill hides
    // (see .nav-search-slot in index.css) so there is only one at a time.
    useEffect(() => {
        const root = document.documentElement;
        const form = formRef.current;
        if (!form || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) root.dataset.heroSearch = 'visible';
            else delete root.dataset.heroSearch;
        }, { rootMargin: '-64px 0px 0px 0px' });
        io.observe(form);
        return () => {
            io.disconnect();
            delete root.dataset.heroSearch;
        };
    }, []);


    return (
        <section className="relative z-20 border-b border-gray-900 pt-24 pb-12 sm:pt-40 sm:pb-24">
            {/* Only the decoration is clipped, so the search dropdown can extend
                past the hero over the shelves below. */}
            <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-dark">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_15%_10%,color-mix(in_srgb,var(--color-accent)_13%,transparent)_0%,transparent_65%)]" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-dark" />
            </div>

            <div className="relative z-10 w-full px-4 md:px-6">
                <div className="max-w-7xl mx-auto">
                <div className="max-w-2xl">
                    <h1 className="text-[1.75rem] leading-[1.1] sm:text-4xl lg:text-5xl sm:leading-[1.04] font-extrabold text-white/90 tracking-tight mb-4 sm:mb-5">
                        Discover, Track, and Share Your Anime Journey
                    </h1>
                    <p className="text-base sm:text-lg text-gray-400 mb-7 sm:mb-8 max-w-xl leading-relaxed">
                        Build your watchlist, rate completed shows, and get personalized picks from what
                        you already love.
                    </p>

                    <HeroSearch ref={formRef} />

                    {showAuthLinks && (
                    <p className="text-sm text-gray-500">
                        <Link to="/register" className="font-semibold text-gray-200 hover:text-white underline decoration-white/20 underline-offset-4 hover:decoration-white/50 transition-colors">
                            Create a free account
                        </Link>
                        <span aria-hidden="true" className="mx-2 text-gray-700">/</span>
                        <Link to="/login" className="font-semibold text-gray-200 hover:text-white underline decoration-white/20 underline-offset-4 hover:decoration-white/50 transition-colors">
                            Sign In
                        </Link>
                        <span className="hidden sm:inline"> to keep your list in sync.</span>
                    </p>
                    )}
                </div>
                </div>
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
            title="Recommended for You"
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
                        className="absolute top-2 right-2 z-[200] w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-md sm:rounded-lg border bg-black/50 border-white/20 text-white hover:bg-black/70 hover:border-white/30 transition-opacity duration-200 opacity-0 group-hover/rec:opacity-100 group-focus-within/rec:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 touch-manipulation after:absolute after:-inset-2 sm:after:inset-0 after:content-['']"
                    >
                        <X aria-hidden="true" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                </div>
            )}
        />
    );
}
