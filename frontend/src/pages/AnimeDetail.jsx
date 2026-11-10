import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { favoriteApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import SEOHelmet from '../components/SEOHelmet';
import { AnimeDetailSkeleton } from '../components/skeletons';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageUrl,
    getImageSrcSet,
    getOptimizedImageUrl,
} from '../utils/imageUtils';
import useAnimeAccentColor from '../hooks/useAnimeAccentColor';
import logger from '../utils/logger';
import { animeKeys, animeQueries } from '../api/queries/anime';
import { favoriteKeys, listKeys, profileKeys, userKeys } from '../api/queries/user';
import { DEFAULT_TAB_ID, TABS, getTabByPath, getTabHref } from '../components/animeDetail/animeDetailTabs';
import TabButton from '../components/animeDetail/TabButton';
import PosterColumn from '../components/animeDetail/PosterColumn';
import TitleSection from '../components/animeDetail/TitleSection';
import AnimeDetailTabContent from '../components/animeDetail/AnimeDetailTabContent';
import ReviewsSection from '../components/animeDetail/ReviewsSection';
import RecommendationsSidebar from '../components/animeDetail/RecommendationsSidebar';
import useAnimeDetailTabData from '../components/animeDetail/useAnimeDetailTabData';
import useAnimeReviews from '../components/animeDetail/useAnimeReviews';

export default function AnimeDetail() {
    const { slug, '*': tabPath } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();
    const { theme } = useTheme();
    const isRetro = theme && theme.startsWith('retro-');
    const queryClient = useQueryClient();
    const [isFavorite, setIsFavorite] = useState(false);
    const [editTriggerKey, setEditTriggerKey] = useState(0);
    const [isLargeViewport, setIsLargeViewport] = useState(() => (
        typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false
    ));
    const [isBannerLoaded, setIsBannerLoaded] = useState(false);
    const [isCoverLoaded, setIsCoverLoaded] = useState(false);
    const [synopsisExpanded, setSynopsisExpanded] = useState(false);
    const containerRef = useRef(null);
    const activeTabConfig = useMemo(() => getTabByPath(tabPath), [tabPath]);
    const activeTab = activeTabConfig?.id || DEFAULT_TAB_ID;
    const animeDetailQueryKey = useMemo(() => animeKeys.detail(slug, user?.id), [slug, user?.id]);

    // Queries
    const { data: anime, isLoading, isError } = useQuery({
        ...animeQueries.detail(slug, user?.id),
        staleTime: 300000, // 5 minutes
        gcTime: 600000, // 10 minutes
    });

    // Tab data (characters, staff, episodes, ratings, recommendations) and reviews
    const tabData = useAnimeDetailTabData({ slug, user, anime, activeTab, queryClient });
    const { watchEpisodesTotal, charactersTotal, staffTotal, recommendations } = tabData;
    const reviews = useAnimeReviews({ slug, anime, user, isAuthenticated, queryClient, animeDetailQueryKey });

    // Derived state
    const accentColor = useAnimeAccentColor(anime?.cover_image, anime?.banner_image);

    // Effects
    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
        }
    }, [anime]);

    // Handlers
    const handleFavorite = useCallback(async () => {
        if (!isAuthenticated) return;
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
            logger.error('Error toggling favorite:', error);
        }
    }, [isAuthenticated, anime?.id, user, queryClient]);

    const handleOpenListEdit = useCallback(() => {
        setEditTriggerKey((current) => current + 1);
    }, []);

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

        queryClient.invalidateQueries({ queryKey: animeKeys.all });
        queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
        queryClient.invalidateQueries({ queryKey: userKeys.watching });
        queryClient.invalidateQueries({ queryKey: listKeys.all });
        queryClient.invalidateQueries({ queryKey: profileKeys.own });
    }, [animeDetailQueryKey, queryClient]);

    useEffect(() => {
        setIsBannerLoaded(false);
        setIsCoverLoaded(false);
    }, [slug]);

    useEffect(() => {
        if (tabPath && !activeTabConfig) {
            navigate(getTabHref(slug, DEFAULT_TAB_ID), { replace: true });
        }
    }, [activeTabConfig, navigate, slug, tabPath]);

    // Loading & Error states
    if (isLoading) return <AnimeDetailSkeleton />;

    if (isError || !anime) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center">
                <p className="text-gray-400 mb-4">Anime not found</p>
                <Link to="/browse" className="btn-primary">Browse Anime</Link>
            </div>
        );
    }

    const relationCoverFallback = location.state?.prefetchedRelationCover;

    const bannerUrl = getOptimizedImageUrl(anime, 'banner', 'large') ||
        getOptimizedImageUrl(anime, 'cover', 'large') ||
        relationCoverFallback ||
        getImageUrl(null, anime.title);
    const coverUrl = getOptimizedImageUrl(anime, 'cover', 'large') ||
        relationCoverFallback ||
        getImageUrl(null, anime.title);
    const bannerSrcSet = getImageSrcSet(anime, 'banner');
    const coverSrcSet = getImageSrcSet(anime, 'cover');
    const bannerFallbackUrl = getImageFallbackUrl(anime, 'banner');
    const coverFallbackUrl = getImageFallbackUrl(anime, 'cover');

    const tabsWithCounts = TABS.map(tab => ({
        ...tab,
        count: tab.id === 'watch' ? watchEpisodesTotal :
            tab.id === 'themes' ? (anime.theme_songs?.length || 0) :
            tab.id === 'characters' ? charactersTotal :
            tab.id === 'staff' ? staffTotal : 0
    }));

    const mappedAccent = isRetro ? 'var(--color-accent)' : (accentColor || 'var(--color-accent)');

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
        editTriggerKey,
        handleListUpdate,
        handleOpenListEdit,
        handleFavorite,
    };

    return (
        <div
            ref={containerRef}
            className="min-h-screen anime-detail-page"
            style={accentColor && !isRetro ? { '--anime-accent': accentColor } : { '--anime-accent': 'var(--color-accent)' }}
        >
            <SEOHelmet anime={anime} />

            {/* Banner */}
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden bg-dark-200">
                {!isBannerLoaded && (
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                    />
                )}
                <img
                    src={bannerUrl}
                    srcSet={bannerSrcSet}
                    sizes="100vw"
                    alt={anime.title}
                    onLoad={() => setIsBannerLoaded(true)}
                    onError={(event) => {
                        setIsBannerLoaded(false);
                        applyImageFallback(event, bannerFallbackUrl);
                    }}
                    className={`w-full h-full object-cover text-transparent transition-opacity duration-700 ease-out ${isBannerLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent" />
            </div>

            {/* Content Container */}
            <div className="relative -mt-32 px-4 sm:px-6 lg:px-8 pb-16">
                <div className="max-w-[1440px] mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-8 min-w-0">
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

                            {/* Tab Navigation */}
                            <div className={`flex items-center gap-1.5 sm:gap-2 mb-6 sm:mb-10 p-1.5 rounded-xl sm:rounded-2xl border overflow-x-auto scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-1.5 ${isRetro ? 'retro-window !rounded-none !bg-dark-100 !backdrop-blur-none pb-2 pt-8' : 'bg-dark-100 border-dark-50'}`}
                                data-title="Navigation"
                            >
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

                            {/* Tab Content */}
                            <AnimeDetailTabContent
                                activeTab={activeTab}
                                anime={anime}
                                accentColor={accentColor}
                                isAuthenticated={isAuthenticated}
                                tabData={tabData}
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

                        {/* Column 3: Sidebar - Recommendations */}
                        <RecommendationsSidebar
                            anime={anime}
                            recommendations={recommendations}
                            accentColor={accentColor}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
