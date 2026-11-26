import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { favoriteApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import SEO from '../components/SEO';
import AnimeDetailSEO from '../components/animeDetail/AnimeDetailSEO';
import { AnimeDetailSkeleton } from '../components/skeletons';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageUrl,
    getImageSrcSet,
    getOptimizedImageUrl,
} from '../utils/imageUtils';
import logger from '../utils/logger';
import { animeKeys, animeQueries, patchAnimeListStatus } from '../api/queries/anime';
import { favoriteKeys, listKeys, profileKeys, userKeys } from '../api/queries/user';
import { DEFAULT_TAB_ID, TABS, getTabByPath, getTabHref } from '../components/animeDetail/animeDetailTabs';
import TabButton from '../components/animeDetail/TabButton';
import PosterColumn from '../components/animeDetail/PosterColumn';
import HeroTint from '../components/animeDetail/HeroTint';
import TitleSection from '../components/animeDetail/TitleSection';
import AnimeDetailTabContent from '../components/animeDetail/AnimeDetailTabContent';
import ReviewsSection from '../components/animeDetail/ReviewsSection';
import RecommendationsSidebar from '../components/animeDetail/RecommendationsSidebar';
import useActivePill from '../hooks/useActivePill';
import useAnimeDetailTabData from '../components/animeDetail/useAnimeDetailTabData';
import useNearViewport from '../components/animeDetail/useNearViewport';
import useAnimeReviews from '../components/animeDetail/useAnimeReviews';
import AdultContentGate, { isAdultGateError } from '../components/animeDetail/AdultContentGate';
import ErrorState from '../components/common/ErrorState';
import useScrollFade from '../hooks/useScrollFade';
import InformationBox from '../components/InformationBox';

// After this long on a loaded page, recommendations load even if their row
// has not come near the viewport yet.
const RECOMMENDATIONS_IDLE_MS = 1500;

export default function AnimeDetail() {
    const { slug, '*': tabPath } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();
    const { theme } = useTheme();
    const isRetro = theme && theme.startsWith('retro-');
    const queryClient = useQueryClient();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isLargeViewport, setIsLargeViewport] = useState(() => (
        typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false
    ));
    // Loaded flags belong to one show: they are stored with its slug, so a new
    // show starts unloaded without a reset effect racing the image's own load
    // event (a cached poster used to load first and then get blanked).
    const [bannerLoadedSlug, setBannerLoadedSlug] = useState(null);
    const [coverLoadedSlug, setCoverLoadedSlug] = useState(null);
    const isBannerLoaded = bannerLoadedSlug === slug;
    const isCoverLoaded = coverLoadedSlug === slug;
    const setIsBannerLoaded = useCallback((loaded) => setBannerLoadedSlug(loaded ? slug : null), [slug]);
    // The slug whose hero image turned out not to be a usable banner (a cover
    // fallback, or too small to fill the page): shown blurred, not stretched.
    const [softBannerSlug, setSoftBannerSlug] = useState(null);
    const setIsCoverLoaded = useCallback((loaded) => setCoverLoadedSlug(loaded ? slug : null), [slug]);
    const [synopsisExpanded, setSynopsisExpanded] = useState(false);
    const containerRef = useRef(null);
    const activeTabConfig = useMemo(() => getTabByPath(tabPath), [tabPath]);
    const activeTab = activeTabConfig?.id || DEFAULT_TAB_ID;
    const tabStripRef = useScrollFade();
    const tabPill = useActivePill();
    const animeDetailQueryKey = useMemo(() => animeKeys.detail(slug, user?.id), [slug, user?.id]);

    // Queries
    const { data: anime, isPending, isError, error, refetch } = useQuery({
        ...animeQueries.detail(slug, user?.id),
        staleTime: 300000, // 5 minutes
        gcTime: 600000, // 10 minutes
    });

    // Recommendations load once their row is about to show, or once the page
    // has settled: on a phone the row sits far below the first screen, and a
    // fast scroll (or a quick look) should still find it filled in.
    const [recommendationsRef, recommendationsNear] = useNearViewport({ resetKey: slug });
    const [settledSlug, setSettledSlug] = useState(null);
    const animeLoaded = Boolean(anime);
    useEffect(() => {
        if (!animeLoaded) return undefined;
        const timer = setTimeout(() => setSettledSlug(slug), RECOMMENDATIONS_IDLE_MS);
        return () => clearTimeout(timer);
    }, [animeLoaded, slug]);

    // Tab data (characters, staff, episodes, ratings, recommendations) and reviews
    const tabData = useAnimeDetailTabData({
        slug,
        user,
        anime,
        activeTab,
        queryClient,
        loadRecommendations: recommendationsNear || settledSlug === slug,
    });
    const { watchEpisodesTotal, charactersTotal, staffTotal, recommendations } = tabData;
    const reviews = useAnimeReviews({ slug, anime, user, isAuthenticated, queryClient, animeDetailQueryKey });

    // Derived state
    // V1: controls use fixed colours; cover art only colours the backdrop.
    const accentColor = null;

    // Effects
    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
        }
    }, [anime]);

    // Handlers
    const handleFavorite = useCallback(async () => {
        if (!isAuthenticated) return;
        // Optimistic: the heart answers the click at once; the server's answer
        // (or a failure) settles it.
        const previous = isFavorite;
        setIsFavorite(!previous);
        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: profileKeys.byUsername(user.username) });
                queryClient.invalidateQueries({ queryKey: favoriteKeys.byUser(user.username) });
                queryClient.invalidateQueries({ queryKey: favoriteKeys.overview(user.username) });
            }
        } catch (error) {
            setIsFavorite(previous);
            logger.error('Error toggling favorite:', error);
        }
    }, [isAuthenticated, isFavorite, anime?.id, user, queryClient]);


    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(min-width: 1024px)');
        const handleViewportChange = (event) => {
            setIsLargeViewport(event.matches);
        };

        setIsLargeViewport(mediaQuery.matches);
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleViewportChange);
            return () => mediaQuery.removeEventListener('change', handleViewportChange);
        }

        mediaQuery.addListener(handleViewportChange);
        return () => mediaQuery.removeListener(handleViewportChange);
    }, []);

    const handleListUpdate = useCallback((nextEntry) => {
        queryClient.setQueryData(animeDetailQueryKey, (currentAnime) => {
            if (!currentAnime) return currentAnime;

            return {
                ...currentAnime,
                user_list_status: nextEntry,
            };
        });

        // Every other cached card for this title (grids, shelves, schedule) gets
        // the new status in place instead of a refetch of everything (B20).
        patchAnimeListStatus(queryClient, anime?.id, nextEntry);
        queryClient.invalidateQueries({ queryKey: userKeys.watching });
        queryClient.invalidateQueries({ queryKey: listKeys.all });
        queryClient.invalidateQueries({ queryKey: profileKeys.own });
    }, [anime?.id, animeDetailQueryKey, queryClient]);

    useEffect(() => {
        if (tabPath && !activeTabConfig) {
            navigate(getTabHref(slug, DEFAULT_TAB_ID), { replace: true });
        }
    }, [activeTabConfig, navigate, slug, tabPath]);

    // Loading & error states. "Not found" only ever follows a failed request
    // (F1): until the first answer arrives the page is a skeleton.
    if (isPending) return <AnimeDetailSkeleton />;

    // An 18+ title for a viewer who has not opted in (D-2): an opt-in gate, not a 404.
    if (isError && isAdultGateError(error)) return <AdultContentGate onEnabled={() => refetch()} />;

    const isNotFound = error?.response?.status === 404 || (!isError && !anime);
    if (isError || !anime) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center px-4 pt-24">
                <SEO page="notFound" noIndex />
                {isNotFound ? (
                    <div className="ui-empty-state w-full max-w-lg">
                        <h1 className="text-lg font-semibold text-[var(--text-1)] mb-2">Anime not found</h1>
                        <p className="text-sm text-[var(--text-2)] mb-6">
                            This page may have moved, or the title isn’t in the catalog yet.
                        </p>
                        <Link to="/browse" className="btn-primary text-sm">Browse anime</Link>
                    </div>
                ) : (
                    <ErrorState
                        className="w-full max-w-lg"
                        title="Couldn’t load this anime"
                        message="The server didn’t respond. Try again in a moment."
                        onRetry={() => refetch()}
                    >
                        <Link to="/browse" className="btn-secondary text-sm">Browse anime</Link>
                    </ErrorState>
                )}
            </div>
        );
    }

    const relationCoverFallback = location.state?.prefetchedRelationCover;

    // The hero shows the show's real banner, sharp (the srcset includes the
    // 1900px original), as AniList does. A show without one gets a shorter,
    // plain header: stretching the portrait cover across the page only ever
    // looked pixelated. The same applies when the banner fails to load or
    // turns out to be no banner (portrait, or far too narrow for the hero).
    const hasBanner = Boolean(
        anime.banner_image_large || anime.banner_image_medium || anime.banner_image || anime.banner_image_external_url
    );
    const showBanner = hasBanner && softBannerSlug !== slug;
    const bannerUrl = hasBanner ? getOptimizedImageUrl(anime, 'banner', 'large') : null;
    const coverUrl = getOptimizedImageUrl(anime, 'cover', 'large') ||
        relationCoverFallback ||
        getImageUrl(null, anime.title);
    const bannerSrcSet = getImageSrcSet(anime, 'banner');
    const coverSrcSet = getImageSrcSet(anime, 'cover');
    // Banner-only fallback: never fall back to the cover here.
    const bannerFallbackUrl = anime.banner_image_external_url || anime.banner_image || null;
    const coverFallbackUrl = getImageFallbackUrl(anime, 'cover');

    const tabsWithCounts = TABS.map(tab => ({
        ...tab,
        count: tab.id === 'watch' ? watchEpisodesTotal :
            tab.id === 'themes' ? (anime.theme_songs?.length || 0) :
            tab.id === 'characters' ? charactersTotal :
            tab.id === 'staff' ? staffTotal : 0
    }));

    const mappedAccent = 'var(--color-accent-fill)';

    // Shared by the large-screen poster column and the small-screen header
    const trackingProps = {
        anime,
        accentColor,
        isAuthenticated,
        coverUrl,
        coverSrcSet,
        coverFallbackUrl,
        isCoverLoaded,
        setIsCoverLoaded,
        isFavorite,
        isLargeViewport,
        handleListUpdate,
        handleFavorite,
    };

    return (
        <div
            ref={containerRef}
            className="min-h-screen anime-detail-page"
            style={accentColor && !isRetro ? { '--anime-accent': accentColor } : { '--anime-accent': 'var(--color-accent)' }}
        >
            <AnimeDetailSEO anime={anime} />

            {/* Banner */}
            <div
                data-banner={showBanner ? 'image' : 'none'}
                className={`relative overflow-hidden bg-[var(--ink-1)] ${showBanner ? 'h-[34vh] min-h-[260px] lg:h-[40vh] lg:min-h-[300px]' : 'h-[230px] lg:h-[260px]'}`}
            >
                {!showBanner && <HeroTint anime={anime} />}
                {hasBanner && (
                <div className="hero-drift absolute inset-0 origin-top">
                <img
                    src={bannerUrl}
                    srcSet={bannerSrcSet}
                    sizes="100vw"
                    alt={anime.title}
                    fetchPriority="high"
                    onLoad={(event) => {
                        // Portrait (a cover) or far narrower than the hero it fills.
                        const { naturalWidth: w, naturalHeight: h, clientWidth } = event.currentTarget;
                        setSoftBannerSlug(w / Math.max(h, 1) < 1.4 || w < clientWidth * 0.7 ? slug : null);
                        setIsBannerLoaded(true);
                    }}
                    onError={(event) => {
                        setIsBannerLoaded(false);
                        if (event.currentTarget.dataset.fallbackApplied === '1' || !bannerFallbackUrl) {
                            setSoftBannerSlug(slug);
                            return;
                        }
                        applyImageFallback(event, bannerFallbackUrl);
                    }}
                    className={`w-full h-full object-cover text-transparent transition-opacity duration-500 ease-out ${isBannerLoaded && showBanner ? 'opacity-100' : 'opacity-0'}`}
                />
                </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent" />
            </div>

            {/* Content Container */}
            <div className="relative -mt-32 pb-16">
                <div className="page-container">
                    {/* Two columns: poster + facts, then everything else. Recommendations
                        sit under the main column as a row of posters (D3). */}
                    <div className="grid grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)] gap-8 xl:gap-12 min-w-0">
                        {/* Column 1: Poster & Mobile Info */}
                        <PosterColumn {...trackingProps} />

                        {/* Column 2: Main Content */}
                        <div className="flex-1 min-w-0">
                            <TitleSection
                                {...trackingProps}
                                mappedAccent={mappedAccent}
                                synopsisExpanded={synopsisExpanded}
                                setSynopsisExpanded={setSynopsisExpanded}
                            />

                            {/* Tab Navigation. On phones it runs to the screen edge, so
                                the next tab is cut under the edge fade and the strip
                                reads as scrollable. */}
                            <nav
                                ref={tabStripRef}
                                aria-label="Sections"
                                className={`scroll-fade -mx-4 mb-4 flex items-center gap-1 overflow-x-auto scrollbar-hide px-4 md:mx-0 md:pl-0 md:pr-6 ${isRetro ? 'retro-window !rounded-none !bg-dark-100 !backdrop-blur-none pb-2 pt-8' : ''}`}
                                data-title="Navigation"
                            >
                                <div ref={tabPill.hostRef} className="pill-host flex shrink-0 items-center gap-1">
                                    <span ref={tabPill.pillRef} aria-hidden="true" className="active-pill" />
                                    {tabsWithCounts.map((tab) => (
                                        <TabButton
                                            key={tab.id}
                                            tab={tab}
                                            isActive={activeTab === tab.id}
                                            to={getTabHref(slug, tab.id)}
                                            accentColor={mappedAccent}
                                            count={tab.count}
                                        />
                                    ))}
                                </div>
                            </nav>

                            {/* Tab Content */}
                            <AnimeDetailTabContent
                                activeTab={activeTab}
                                anime={anime}
                                accentColor={accentColor}
                                isAuthenticated={isAuthenticated}
                                tabData={tabData}
                            />

                            {/* Phones/tablets: the key facts are already in the title's
                                meta line, so the full details follow the overview. The
                                next episode is not repeated here: it sits under the
                                tracking controls in TitleSection. */}
                            {activeTab === DEFAULT_TAB_ID && (
                                <div className="lg:hidden mt-4">
                                    <InformationBox anime={anime} accentColor={accentColor} showNextEpisode={false} />
                                </div>
                            )}

                            {/* Recommendations: loaded once this block nears the viewport */}
                            <RecommendationsSidebar
                                anime={anime}
                                recommendations={recommendations}
                                accentColor={accentColor}
                                containerRef={recommendationsRef}
                            />

                            {/* Reviews Section */}
                            <ReviewsSection
                                anime={anime}
                                reviews={reviews}
                                isAuthenticated={isAuthenticated}
                                accentColor={accentColor}
                                mappedAccent={mappedAccent}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
