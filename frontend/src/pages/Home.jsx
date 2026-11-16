import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, Pause, Star, ChevronRight, Plus, Check, Loader2, X } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import logger from '../utils/logger';
import { formatRelativeTime } from '../utils/dateUtils';
import SEO from '../components/SEO';
import SectionHeader from '../components/common/SectionHeader';
import ErrorState from '../components/common/ErrorState';
import HeroSearch from '../components/home/HeroSearch';
import AnimeMediaImage from '../components/common/AnimeMediaImage';
import { animeQueries, patchAnimeListStatus, scheduleQueries } from '../api/queries/anime';
import { listKeys, userQueries } from '../api/queries/user';
import { recommendationMutations, recommendationQueries } from '../api/queries/recommendations';

const UP_NEXT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UP_NEXT_LIMIT = 6;

/**
 * Watching entries from the (already cached, per-user enriched) schedule
 * payload whose next episode airs within the next 7 days, soonest first.
 */
function selectUpNext(scheduleDays, now = Date.now()) {
    const seen = new Set();
    return Object.values(scheduleDays || {})
        .flatMap((items) => (Array.isArray(items) ? items : []))
        .filter((anime) => {
            if (!anime || seen.has(anime.id)) return false;
            if (anime.user_list_status?.status !== 'Watching') return false;
            const airsAt = Date.parse(anime.next_airing_date);
            if (!Number.isFinite(airsAt) || airsAt < now || airsAt > now + UP_NEXT_WINDOW_MS) return false;
            seen.add(anime.id);
            return true;
        })
        .sort((a, b) => Date.parse(a.next_airing_date) - Date.parse(b.next_airing_date))
        .slice(0, UP_NEXT_LIMIT);
}

export default function Home() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [currentHeroIndex, setCurrentHeroIndex] = useState(0);
    const [heroListLoading, setHeroListLoading] = useState(false);
    const [locallyAddedIds, setLocallyAddedIds] = useState(new Set());
    const [heroPaused, setHeroPaused] = useState(false);
    const [heroStopped, setHeroStopped] = useState(false);
    const revealRefs = useRef([]);
    const observer = useRef(null);

    // Hero carousel data is fetched only for authenticated users
    const {
        data: memberTrending,
        isLoading: memberTrendingLoading,
        isError: memberTrendingError,
        refetch: refetchMemberTrending,
    } = useQuery({
        ...animeQueries.trending('member-home'),
        staleTime: 1000 * 60 * 15, // 15 minutes
        gcTime: 1000 * 60 * 30,
        priority: 'high', // Load this first
        enabled: isAuthenticated,
    });

    // Guests still get sections data even though the hero is static
    const {
        data: guestTrending,
        isLoading: guestTrendingLoading,
        isError: guestTrendingError,
        refetch: refetchGuestTrending,
    } = useQuery({
        ...animeQueries.trending('guest-home'),
        staleTime: 1000 * 60 * 15,
        gcTime: 1000 * 60 * 30,
        enabled: !isAuthenticated,
    });

    const trending = isAuthenticated ? memberTrending : guestTrending;
    const trendingLoading = isAuthenticated ? memberTrendingLoading : guestTrendingLoading;
    const trendingError = isAuthenticated ? memberTrendingError : guestTrendingError;
    const refetchTrending = isAuthenticated ? refetchMemberTrending : refetchGuestTrending;
    const heroCarousel = memberTrending?.slice(0, 5) || [];

    const { data: topRated, isLoading: topRatedLoading } = useQuery({
        ...animeQueries.topRated(),
        staleTime: 1000 * 60 * 30,
        gcTime: 1000 * 60 * 60,
        retry: false,
    });

    // Hero Carousel Logic - optimized with useCallback
    // Auto-advance, paused while the hero is hovered/focused, and off entirely
    // for people who ask for reduced motion.
    useEffect(() => {
        if (!isAuthenticated || heroCarousel.length === 0 || heroPaused || heroStopped) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const interval = setInterval(() => {
            setCurrentHeroIndex((prev) => (prev + 1) % heroCarousel.length);
        }, 8000);
        return () => clearInterval(interval);
    }, [isAuthenticated, heroCarousel.length, heroPaused, heroStopped]);

    useEffect(() => {
        if (!isAuthenticated) return;
        if (heroCarousel.length === 0 || currentHeroIndex < heroCarousel.length) return;
        setCurrentHeroIndex(0);
    }, [isAuthenticated, heroCarousel.length, currentHeroIndex]);

    const heroAnime = heroCarousel.length > 0 ? heroCarousel[currentHeroIndex] : null;

    const isHeroInList = heroAnime && (
        !!heroAnime.user_list_status?.status ||
        locallyAddedIds.has(heroAnime.id)
    );

    const handleAddToList = useCallback(async () => {
        if (!isAuthenticated || !heroAnime || heroListLoading || isHeroInList) return;

        setHeroListLoading(true);
        try {
            const response = await listApi.add({ anime_id: heroAnime.id, status: 'Plan to Watch' });
            setLocallyAddedIds(prev => new Set(prev).add(heroAnime.id));
            patchAnimeListStatus(queryClient, heroAnime.id, {
                id: response?.data?.id ?? null,
                status: 'Plan to Watch',
                episodes_watched: 0,
            });
            queryClient.invalidateQueries({ queryKey: listKeys.all });
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
                {isAuthenticated && (memberTrendingLoading || heroCarousel.length > 0) ? (
                    <MemberCarouselHero
                        heroCarousel={heroCarousel}
                        currentHeroIndex={currentHeroIndex}
                        onSelectHero={setCurrentHeroIndex}
                        onPauseChange={setHeroPaused}
                        isStopped={heroStopped}
                        onToggleStopped={() => setHeroStopped((prev) => !prev)}
                        heroAnime={heroAnime}
                        heroListLoading={heroListLoading}
                        isHeroInList={isHeroInList}
                        onAddToList={handleAddToList}
                    />
                ) : (
                    <GuestIntroHero showAuthLinks={!isAuthenticated} />
                )}

                {/* Main Content Area */}
                <div className="relative space-y-12 md:space-y-16 pt-6 pb-10 md:py-14">
                    {isAuthenticated && <UpNextSection />}
                    {isAuthenticated && <CurrentlyWatchingSection />}

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

                    {/* Recommended For You Section */}
                    <RecommendedForYouSection revealRef={setRevealRef} />

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

function MemberCarouselHero({
    heroCarousel,
    currentHeroIndex,
    onSelectHero,
    onPauseChange,
    isStopped,
    onToggleStopped,
    heroAnime,
    heroListLoading,
    isHeroInList,
    onAddToList,
}) {
    const year = heroAnime && (heroAnime.start_date || heroAnime.release_date)
        ? new Date(heroAnime.start_date || heroAnime.release_date).getFullYear()
        : null;

    return (
        <section
            aria-roledescription="carousel"
            aria-label="Trending now"
            className="relative h-[50vh] min-h-[380px] sm:h-[62vh] sm:min-h-[460px] max-h-[680px] flex items-end pb-6 sm:pb-14 overflow-hidden"
            onMouseEnter={() => onPauseChange(true)}
            onMouseLeave={() => onPauseChange(false)}
            onFocus={() => onPauseChange(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) onPauseChange(false);
            }}
        >
            <div aria-hidden="true" className="absolute inset-0 bg-dark">
                {heroCarousel.map((anime, index) => (
                    <div
                        key={anime.id}
                        className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentHeroIndex ? 'opacity-100' : 'opacity-0'}`}
                    >
                        <AnimeMediaImage
                            anime={anime}
                            kind="banner"
                            size="large"
                            alt=""
                            responsive
                            sizes="100vw"
                            loading={index === 0 ? 'eager' : 'lazy'}
                            fetchPriority={index === 0 ? 'high' : 'auto'}
                            className="w-full h-full object-cover"
                        />
                    </div>
                ))}
                <div className="absolute inset-0 bg-dark/60" />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/75 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-dark/20 to-transparent" />
            </div>

            <div className="relative z-10 w-full px-4 md:px-6">
                <div className="max-w-7xl mx-auto">
                {heroAnime && (
                    <div key={heroAnime.id} className="max-w-2xl page-enter" aria-live={isStopped ? 'polite' : 'off'}>
                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white/90 tracking-tight leading-[1.05] mb-3 line-clamp-2">
                            {heroAnime.title}
                        </h1>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium text-gray-300 mb-4 sm:mb-5 tabular">
                            {heroAnime.rating && (
                                <span className="flex items-center gap-1.5 text-yellow-400 font-bold">
                                    <Star aria-hidden="true" className="w-4 h-4 fill-current" />
                                    <span className="sr-only">Rating </span>{heroAnime.rating}
                                </span>
                            )}
                            {heroAnime.anime_type && (
                                <>
                                    {heroAnime.rating && <span aria-hidden="true" className="text-gray-600">•</span>}
                                    <span className="text-gray-100 uppercase tracking-widest text-[11px] sm:text-xs font-bold">{heroAnime.anime_type}</span>
                                </>
                            )}
                            {year && (
                                <>
                                    <span aria-hidden="true" className="text-gray-600">•</span>
                                    <span className="text-gray-200">{year}</span>
                                </>
                            )}
                            {heroAnime.genres?.length > 0 && (
                                <>
                                    <span aria-hidden="true" className="hidden sm:inline text-gray-600">•</span>
                                    <span className="w-full sm:w-auto text-gray-400 line-clamp-1">{heroAnime.genres.slice(0, 3).map(g => g.name).join(', ')}</span>
                                </>
                            )}
                        </div>

                        <p className="text-sm sm:text-base md:text-lg text-gray-300 mb-6 sm:mb-8 max-w-2xl line-clamp-2 md:line-clamp-3 leading-relaxed">
                            {heroAnime.synopsis}
                        </p>

                        <div className="flex flex-wrap items-center gap-3">
                            <Link
                                to={`/anime/${heroAnime.slug}`}
                                className="btn-primary min-w-[140px] px-6 py-2.5 sm:px-7 sm:py-3"
                            >
                                <Play aria-hidden="true" className="w-4 h-4 fill-current" />
                                View Details
                            </Link>
                            {isHeroInList ? (
                                <span className="inline-flex items-center gap-2 px-2 text-sm font-semibold text-gray-300">
                                    <Check aria-hidden="true" className="w-4 h-4 text-emerald-400" />
                                    In your list
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onAddToList}
                                    disabled={heroListLoading}
                                    aria-busy={heroListLoading}
                                    className="btn-secondary min-w-[140px] px-6 py-2.5 sm:px-7 sm:py-3"
                                >
                                    {heroListLoading
                                        ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                                        : <Plus aria-hidden="true" className="w-4 h-4" />}
                                    Add to List
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {heroCarousel.length > 1 && (
                    <div className="mt-7 sm:mt-9 flex items-center gap-1.5" role="group" aria-label="Choose slide">
                        <button
                            type="button"
                            onClick={onToggleStopped}
                            aria-label={isStopped ? 'Resume slideshow' : 'Pause slideshow'}
                            aria-pressed={isStopped}
                            className="mr-1.5 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            {isStopped
                                ? <Play aria-hidden="true" className="w-3 h-3 fill-current" />
                                : <Pause aria-hidden="true" className="w-3 h-3 fill-current" />}
                        </button>
                        {heroCarousel.map((anime, index) => (
                            <button
                                key={anime.id}
                                type="button"
                                onClick={() => {
                                    onSelectHero(index);
                                    if (!isStopped) onToggleStopped();
                                }}
                                aria-label={`Show ${anime.title}`}
                                aria-current={index === currentHeroIndex}
                                className="group py-2 px-0.5"
                            >
                                <span
                                    className={`block h-1 rounded-full transition-[width,background-color] duration-300 ${index === currentHeroIndex ? 'w-6 bg-white/80' : 'w-3 bg-white/25 group-hover:bg-white/45'}`}
                                />
                            </button>
                        ))}
                    </div>
                )}
                </div>
            </div>
        </section>
    );
}

// Members: what airs next from the shows they're watching. Reuses the
// schedule query (same key as the Schedule page), so it costs no new request
// once either page has loaded. Hidden while loading and when empty.
function UpNextSection() {
    const { isAuthenticated, user } = useAuth();
    const adultContentEnabled = Boolean(user?.show_adult_content);
    const preferredTimezone = user?.preferred_timezone;

    const { data: scheduleDays, isLoading } = useQuery({
        ...scheduleQueries.week(isAuthenticated, adultContentEnabled),
        staleTime: 5 * 60 * 1000,
        enabled: isAuthenticated,
    });

    const upNext = useMemo(() => selectUpNext(scheduleDays), [scheduleDays]);

    if (isLoading || upNext.length === 0) return null;

    return (
        <AnimeShelf
            title="Up next"
            viewAllTo="/schedule?mine=1"
            items={upNext}
            renderItem={(anime, index) => {
                const when = formatRelativeTime(anime.next_airing_date, preferredTimezone);
                return (
                    <AnimeCard
                        anime={anime}
                        index={index}
                        metaText={anime.next_airing_episode ? `EP ${anime.next_airing_episode} · ${when}` : when}
                    />
                );
            }}
        />
    );
}

function CurrentlyWatchingSection() {
    const { isAuthenticated } = useAuth();

    const { data: watching, isLoading } = useQuery({
        ...userQueries.watching(),
        staleTime: 1000 * 60 * 2,
        retry: false,
        enabled: isAuthenticated, // Only fetch if authenticated
    });

    if (isLoading || !watching || watching.length === 0) return null;

    return (
        <AnimeShelf
            title="Currently Watching"
            viewAllTo="/profile/anime_list"
            items={watching}
            renderItem={(entry) => (
                <AnimeCard
                    anime={entry.anime}
                    userListEntry={entry}
                    showProgress
                    metaText={entry.anime?.episode_count
                        ? `Ep ${entry.episodes_watched || 0} / ${entry.anime.episode_count}`
                        : `Ep ${entry.episodes_watched || 0}`}
                />
            )}
        />
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
            items={recommendations}
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
