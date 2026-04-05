import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { Star, Heart, Plus, Loader, MessageSquare, Film, BarChart3, Users, Mic, ChevronDown, Tv, Disc } from 'lucide-react';
import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { animeApi, favoriteApi, reviewApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import AnimeCard from '../components/AnimeCard';
import StatusSelector from '../components/StatusSelector';
import ReviewCard from '../components/ReviewCard';
import ReviewForm from '../components/ReviewForm';
import ReviewSummary from '../components/ReviewSummary';
import StaffModal from '../components/StaffModal';
import StatsTab from '../components/StatsTab';
import InformationBox from '../components/InformationBox';
import FriendsWatching from '../components/FriendsWatching';
import SEOHelmet from '../components/SEOHelmet';
import { OverviewTab, CharactersTab, StaffTab, ThemesTab } from '../components/DetailTabs';
import EpisodesTab from '../components/EpisodesTab';
import { AnimeDetailSkeleton } from '../components/skeletons';
import AnimeMediaImage from '../components/common/AnimeMediaImage';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageSrcSet,
    getOptimizedImageUrl,
    isSameOriginImageUrl,
} from '../utils/imageUtils';
import logger from '../utils/logger';

// Memoized tab configuration to prevent re-renders
const TABS = [
    { id: 'overview', label: 'Overview', icon: Film, path: 'overview' },
    { id: 'watch', label: 'Watch', icon: Tv, path: 'watch' },
    { id: 'themes', label: 'Themes', icon: Disc, path: 'themes' },
    { id: 'stats', label: 'Stats', icon: BarChart3, path: 'stats' },
    { id: 'characters', label: 'Characters', icon: Users, path: 'characters' },
    { id: 'staff', label: 'Staff', icon: Mic, path: 'staff' },
];

const DEFAULT_TAB_ID = 'overview';
const WATCH_PREVIEW_PAGE_SIZE = 4;
const WATCH_TAB_PAGE_SIZE = 50;

const getTabByPath = (tabPath) => {
    const normalizedPath = tabPath?.replace(/^\/+|\/+$/g, '') || '';
    if (!normalizedPath) {
        return TABS.find((tab) => tab.id === DEFAULT_TAB_ID) || null;
    }

    return TABS.find((tab) => tab.path === normalizedPath) || null;
};

const getTabHref = (slug, tabId) => {
    const tab = TABS.find((entry) => entry.id === tabId);
    if (!tab?.path) {
        return `/anime/${slug}`;
    }

    return `/anime/${slug}/${tab.path}`;
};

const getUniqueCharacterCount = (characters) => {
    if (!Array.isArray(characters)) return 0;

    const seen = new Set();
    for (const role of characters) {
        const characterName = role?.character?.name;
        if (!characterName) continue;

        const voiceActorName = role?.voice_actor?.name || 'none';
        seen.add(`${characterName}:${role?.role || 'unknown'}:${voiceActorName}`);
    }

    return seen.size;
};

const getUniqueStaffCount = (staff) => {
    if (!Array.isArray(staff)) return 0;

    const seen = new Set();
    for (const staffRole of staff) {
        const staffName = staffRole?.staff?.name;
        if (!staffName) continue;

        const roleName = staffRole?.role || 'unknown';
        seen.add(`${staffName}:${roleName}`);
    }

    return seen.size;
};

const getCoverPlaceholder = (title = 'Anime') =>
    `https://placehold.co/10131b/75698d?text=${encodeURIComponent(title)}`;

// Extract and memoize color from image
const useAccentColor = (coverImage, bannerImage) => {
    const [accentColor, setAccentColor] = useState(null);

    useEffect(() => {
        const safeCoverImage = isSameOriginImageUrl(coverImage) ? coverImage : null;
        const safeBannerImage = isSameOriginImageUrl(bannerImage) ? bannerImage : null;

        if (!safeCoverImage && !safeBannerImage) {
            setAccentColor(null);
            return;
        }

        const extractColor = (imageUrl) => {
            return new Promise((resolve, reject) => {
                const img = new Image();

                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = 1;
                        canvas.height = 1;
                        ctx.drawImage(img, 0, 0, 1, 1);
                        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                        resolve({ r, g, b });
                    } catch (e) {
                        reject(e);
                    }
                };

                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = imageUrl;
            });
        };

        const processColor = ({ r, g, b }) => {
            // Convert RGB to HSL
            const rNorm = r / 255;
            const gNorm = g / 255;
            const bNorm = b / 255;
            
            const max = Math.max(rNorm, gNorm, bNorm);
            const min = Math.min(rNorm, gNorm, bNorm);
            let h, s, l = (max + min) / 2;

            if (max === min) {
                h = s = 0; // achromatic
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
                    case gNorm: h = (bNorm - rNorm) / d + 2; break;
                    case bNorm: h = (rNorm - gNorm) / d + 4; break;
                }
                h /= 6;
            }

            // Clamp lightness and saturation for a better dark theme experience
            const minLightness = 0.45;
            const maxLightness = 0.65;
            const minSaturation = 0.3;

            l = Math.max(minLightness, Math.min(maxLightness, l));
            if (s > 0) {
                s = Math.max(minSaturation, s);
            }

            // Convert back to RGB
            let finalR, finalG, finalB;
            if (s === 0) {
                finalR = finalG = finalB = l; // achromatic
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1/6) return p + (q - p) * 6 * t;
                    if (t < 1/2) return q;
                    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                finalR = hue2rgb(p, q, h + 1/3);
                finalG = hue2rgb(p, q, h);
                finalB = hue2rgb(p, q, h - 1/3);
            }

            const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
            setAccentColor(`#${toHex(finalR)}${toHex(finalG)}${toHex(finalB)}`);
        };

        extractColor(safeCoverImage || safeBannerImage)
            .then(processColor)
            .catch(() => {
                if (safeBannerImage) {
                    extractColor(safeBannerImage)
                        .then(processColor)
                        .catch(() => setAccentColor(null));
                } else {
                    setAccentColor(null);
                }
            });
    }, [coverImage, bannerImage]);

    return accentColor;
};

// Memoized share button handler
const useShare = () => {
    return useMemo(() => () => {
        navigator.clipboard.writeText(window.location.href);
        // Could use a toast notification here instead of alert
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg  z-50 animate-fade-in';
        toast.textContent = 'Link copied!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }, []);
};

// Memoized related anime card component
const RelatedAnimeCard = memo(({ anime }) => {
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        setIsLoaded(false);
    }, [anime?.id, anime?.cover_image, anime?.cover_image_small, anime?.cover_image_external_url]);

    return (
        <Link
            to={`/anime/${anime.slug}`}
            className="flex gap-4 group bg-dark-100/30 p-2 rounded-xl border border-transparent hover:border-gray-800 hover:bg-dark-100/50 transition-all"
        >
            <div className="relative w-20 h-28 flex-shrink-0 overflow-hidden rounded-lg bg-dark-200">
                {!isLoaded && (
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                    />
                )}
                <AnimeMediaImage
                    anime={anime}
                    kind="cover"
                    size="small"
                    alt={anime.title}
                    className={`w-full h-full object-cover text-transparent transition-opacity duration-500 ease-out ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                    loading="lazy"
                    onLoad={() => setIsLoaded(true)}
                />
            </div>
            <div className="flex-1 py-1 min-w-0">
                <h3 className="text-gray-300 font-bold text-sm line-clamp-2 transition-colors leading-tight mb-1 group-hover:text-white">
                    {anime.title}
                </h3>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{anime.anime_type}</span>
                    <span>•</span>
                    <div className="flex items-center gap-1 bg-yellow-500/10 px-1.5 py-0.5 rounded text-yellow-500 font-bold">
                        <Star className="w-3 h-3 fill-current" />
                        <span>{anime.rating || 'N/A'}</span>
                    </div>
                </div>
            </div>
        </Link>
    );
});

RelatedAnimeCard.displayName = 'RelatedAnimeCard';

// Memoized mobile related anime card
const MobileRelatedCard = memo(({ anime }) => {
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        setIsLoaded(false);
    }, [anime?.id, anime?.cover_image, anime?.cover_image_small, anime?.cover_image_external_url]);

    return (
        <Link
            to={`/anime/${anime.slug}`}
            className="flex-shrink-0 w-28 sm:w-32 snap-start group"
        >
            <div className="relative aspect-[2/3] rounded-lg overflow-hidden mb-2 border border-gray-800 bg-dark-200">
                {!isLoaded && (
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                    />
                )}
                <AnimeMediaImage
                    anime={anime}
                    kind="cover"
                    size="small"
                    alt={anime.title}
                    className={`w-full h-full object-cover text-transparent transition-opacity duration-500 ease-out ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                    loading="lazy"
                    onLoad={() => setIsLoaded(true)}
                />
            </div>
            <h3 className="text-gray-300 font-bold text-xs line-clamp-2 leading-tight mb-1 group-hover:text-white transition-colors">
                {anime.title}
            </h3>
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span>{anime.anime_type}</span>
                <span>•</span>
                <div className="flex items-center gap-0.5 bg-yellow-500/10 px-1 py-0.5 rounded text-yellow-500 font-bold">
                    <Star className="w-2.5 h-2.5 fill-current" />
                    <span>{anime.rating || 'N/A'}</span>
                </div>
            </div>
        </Link>
    );
});

MobileRelatedCard.displayName = 'MobileRelatedCard';

// Memoized tab button component
const TabButton = memo(({ tab, isActive, to, accentColor, count }) => {
    return (
        <Link
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 min-h-[40px] sm:min-h-0
                ${isActive
                    ? 'text-white '
                    : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            style={isActive ? {
                backgroundColor: accentColor || '#75698d'
            } : {}}
        >
            {tab.label}
            {count > 0 && (
                <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/20' : 'bg-white/5'}`}>
                    {count}
                </span>
            )}
        </Link>
    );
});

TabButton.displayName = 'TabButton';

export default function AnimeDetail() {
    const { slug, '*': tabPath } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();
    const { theme } = useTheme();
    const isRetro = theme && theme.startsWith('retro-');
    const queryClient = useQueryClient();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isWritingReview, setIsWritingReview] = useState(false);
    const [editingReview, setEditingReview] = useState(null);
    const [reviewSort, setReviewSort] = useState('helpful');
    const [ratingFilter, setRatingFilter] = useState(null);
    const [hideSpoilersGlobal, setHideSpoilersGlobal] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState(null);
    const [isBannerLoaded, setIsBannerLoaded] = useState(false);
    const [isCoverLoaded, setIsCoverLoaded] = useState(false);
    const [synopsisExpanded, setSynopsisExpanded] = useState(false);
    const containerRef = useRef(null);
    const activeTabConfig = useMemo(() => getTabByPath(tabPath), [tabPath]);
    const activeTab = activeTabConfig?.id || DEFAULT_TAB_ID;
    const animeDetailQueryKey = useMemo(() => ['anime', slug, user?.id || 'anonymous'], [slug, user?.id]);
    const watchPreviewQueryKey = useMemo(() => ['anime', slug, 'watch-episodes-preview'], [slug]);
    const watchEpisodesQueryKey = useMemo(() => ['anime', slug, 'watch-episodes', WATCH_TAB_PAGE_SIZE], [slug]);
    const shouldLoadWatchPreview = activeTab === 'overview';
    const shouldLoadWatchTab = activeTab === 'watch';

    // Queries
    const { data: anime, isLoading, isError } = useQuery({
        queryKey: animeDetailQueryKey,
        queryFn: () => animeApi.getBySlug(slug).then(res => res.data),
        staleTime: 300000, // 5 minutes
        gcTime: 600000, // 10 minutes
    });

    const { data: characters, isLoading: charactersLoading } = useQuery({
        queryKey: ['anime', slug, 'characters'],
        queryFn: () => animeApi.getCharacters(slug).then(res => res.data),
        enabled: !!anime && (activeTab === 'characters' || activeTab === 'overview'),
        staleTime: Infinity, // Character lists rarely change
    });

    const { data: staff, isLoading: staffLoading } = useQuery({
        queryKey: ['anime', slug, 'staff'],
        queryFn: () => animeApi.getStaff(slug).then(res => res.data),
        enabled: !!anime && (activeTab === 'staff' || activeTab === 'overview'),
        staleTime: Infinity, // Staff lists rarely change
    });

    const {
        data: watchPreviewData,
    } = useQuery({
        queryKey: watchPreviewQueryKey,
        queryFn: () => animeApi.getWatchEpisodes(slug, {
            page: 1,
            page_size: WATCH_PREVIEW_PAGE_SIZE,
        }).then((res) => res.data),
        enabled: !!anime && shouldLoadWatchPreview,
        staleTime: 300000,
    });

    const {
        data: watchEpisodesData,
        fetchNextPage: fetchNextWatchEpisodesPage,
        hasNextPage: hasNextWatchEpisodesPage,
        isFetchingNextPage: isFetchingNextWatchEpisodesPage,
        isLoading: watchEpisodesLoading,
        isError: watchEpisodesIsError,
        refetch: refetchWatchEpisodes,
    } = useInfiniteQuery({
        queryKey: watchEpisodesQueryKey,
        queryFn: ({ pageParam }) => animeApi.getWatchEpisodes(slug, {
            page: pageParam,
            page_size: WATCH_TAB_PAGE_SIZE,
        }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage?.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch {
                    return undefined;
                }
            }
            return undefined;
        },
        enabled: !!anime && shouldLoadWatchTab,
        staleTime: 300000,
    });

    const {
        data: episodeRatings,
        isLoading: episodeRatingsLoading,
    } = useQuery({
        queryKey: ['anime', slug, 'episode-ratings', user?.id || 'anonymous'],
        queryFn: () => animeApi.getEpisodeRatings(slug).then(res => res.data),
        enabled: !!anime && (activeTab === 'watch' || activeTab === 'stats'),
        staleTime: 60000,
    });

    const { data: reviewsData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading: reviewsLoading } = useInfiniteQuery({
        queryKey: ['reviews', slug, reviewSort, ratingFilter],
        queryFn: ({ pageParam }) => reviewApi.getAll({
            anime: slug,
            page: pageParam,
            sort: reviewSort,
            rating: ratingFilter
        }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage?.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!slug
    });

    const { data: reviewStats } = useQuery({
        queryKey: ['reviewStats', slug],
        queryFn: () => reviewApi.getStats(slug).then(res => res.data),
        enabled: !!slug
    });

    const { data: recommendations } = useQuery({
        queryKey: ['anime', slug, 'recommendations'],
        queryFn: () => animeApi.getRecommendations(slug).then(res => res.data),
        enabled: !!anime,
    });

    // Derived state
    const accentColor = useAccentColor(anime?.cover_image, anime?.banner_image);
    const handleShare = useShare();

    const allReviews = useMemo(() =>
        reviewsData?.pages.flatMap(page => Array.isArray(page) ? page : (page.results || [])) || [],
        [reviewsData]
    );

    const watchEpisodes = useMemo(() =>
        watchEpisodesData?.pages.flatMap((page) => page?.results || []) || [],
        [watchEpisodesData]
    );
    const previewEpisodes = useMemo(
        () => watchPreviewData?.results || [],
        [watchPreviewData]
    );
    const displayEpisodes = activeTab === 'watch' ? watchEpisodes : previewEpisodes;
    const rawWatchEpisodesCount = watchEpisodesData?.pages?.[0]?.count ?? watchPreviewData?.count;
    const parsedWatchEpisodesCount = Number(rawWatchEpisodesCount);
    const watchEpisodesTotal = Number.isFinite(parsedWatchEpisodesCount) && parsedWatchEpisodesCount >= 0
        ? parsedWatchEpisodesCount
        : (anime?.episode_count || 0);

    const { textReviews, ratingOnlyReviews, reviewCount } = useMemo(() => ({
        textReviews: allReviews.filter(r => r.text?.trim().length > 0),
        ratingOnlyReviews: allReviews.filter(r => !r.text?.trim()),
        reviewCount: reviewsData?.pages[0]?.count ?? anime?.review_count ?? allReviews.length
    }), [allReviews, reviewsData, anime]);

    const userReview = useMemo(() =>
        anime?.user_review || allReviews.find(r => r.user?.username === user?.username),
        [anime, allReviews, user]
    );

    const canReview = isAuthenticated && anime?.user_list_status != null;

    // Effects
    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
        }
    }, [anime]);

    useEffect(() => {
        if (!anime || activeTab !== 'overview') {
            return;
        }

        queryClient.prefetchInfiniteQuery({
            queryKey: watchEpisodesQueryKey,
            queryFn: ({ pageParam = 1 }) => animeApi.getWatchEpisodes(slug, {
                page: pageParam,
                page_size: WATCH_TAB_PAGE_SIZE,
            }).then((res) => res.data),
            initialPageParam: 1,
            staleTime: 300000,
        });
    }, [anime, activeTab, queryClient, slug, watchEpisodesQueryKey]);

    // Mutations
    const createReviewMutation = useMutation({
        mutationFn: (data) => reviewApi.create({ ...data, anime_slug: slug }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
            }
            setIsWritingReview(false);
        },
    });

    const updateReviewMutation = useMutation({
        mutationFn: ({ id, data }) => reviewApi.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
            setEditingReview(null);
        },
    });

    const deleteReviewMutation = useMutation({
        mutationFn: (id) => reviewApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites-overview', user.username] });
            }
        },
    });

    const setEpisodeRatingMutation = useMutation({
        mutationFn: ({ episodeNumber, rating }) =>
            animeApi.setEpisodeRating(slug, episodeNumber, { rating }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: watchEpisodesQueryKey });
            queryClient.invalidateQueries({ queryKey: watchPreviewQueryKey });
            queryClient.invalidateQueries({ queryKey: ['anime', slug, 'episode-ratings'] });
        },
    });

    const clearEpisodeRatingMutation = useMutation({
        mutationFn: (episodeNumber) => animeApi.clearEpisodeRating(slug, episodeNumber),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: watchEpisodesQueryKey });
            queryClient.invalidateQueries({ queryKey: watchPreviewQueryKey });
            queryClient.invalidateQueries({ queryKey: ['anime', slug, 'episode-ratings'] });
        },
    });

    // Handlers
    const handleFavorite = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites-overview', user.username] });
            }
        } catch (error) {
            logger.error('Error toggling favorite:', error);
        }
    }, [isAuthenticated, anime?.id, user, queryClient]);

    const handleListUpdate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['anime'] });
        queryClient.invalidateQueries({ queryKey: animeDetailQueryKey });
        queryClient.invalidateQueries({ queryKey: ['user', 'list', 'watching'] });
        queryClient.invalidateQueries({ queryKey: ['lists'] });
        queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
    }, [animeDetailQueryKey, queryClient]);

    const handleReviewSubmit = useCallback(async (data) => {
        if (editingReview) {
            await updateReviewMutation.mutateAsync({ id: editingReview.id, data });
        } else {
            await createReviewMutation.mutateAsync(data);
        }
    }, [editingReview, updateReviewMutation, createReviewMutation]);

    const handleEpisodeRatingChange = useCallback(async (episodeNumber, rating) => {
        await setEpisodeRatingMutation.mutateAsync({ episodeNumber, rating });
    }, [setEpisodeRatingMutation]);

    const handleEpisodeRatingClear = useCallback(async (episodeNumber) => {
        await clearEpisodeRatingMutation.mutateAsync(episodeNumber);
    }, [clearEpisodeRatingMutation]);

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
        `https://placehold.co/10131b/75698d?text=${encodeURIComponent(anime.title)}`;
    const coverUrl = getOptimizedImageUrl(anime, 'cover', 'large') ||
        relationCoverFallback ||
        `https://placehold.co/10131b/75698d?text=${encodeURIComponent(anime.title)}`;
    const bannerSrcSet = getImageSrcSet(anime, 'banner');
    const coverSrcSet = getImageSrcSet(anime, 'cover');
    const bannerFallbackUrl = getImageFallbackUrl(anime, 'banner');
    const coverFallbackUrl = getImageFallbackUrl(anime, 'cover');

    const tabsWithCounts = TABS.map(tab => ({
        ...tab,
        count: tab.id === 'watch' ? watchEpisodesTotal :
            tab.id === 'themes' ? (anime.theme_songs?.length || 0) :
            tab.id === 'characters' ? (anime.character_count || 0) :
            tab.id === 'staff' ? (anime.staff_count || 0) : 0
    }));

    const mappedAccent = isRetro ? 'var(--color-accent)' : (accentColor || 'var(--color-accent)');

    const toSafeInt = (value, fallback = 0) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };

    const watchedEpisodes = toSafeInt(anime?.user_list_status?.episodes_watched);
    const episodeDuration = toSafeInt(anime?.duration_minutes, 24) || 24;
    const totalEpisodes = toSafeInt(anime?.episode_count);
    const hasTrackedProgress = anime?.user_list_status != null;
    const minutesToDisplay = (hasTrackedProgress ? watchedEpisodes : totalEpisodes) * episodeDuration;
    const watchTimeLabel = minutesToDisplay > 0
        ? `${Math.floor(minutesToDisplay / 60)}h ${minutesToDisplay % 60}m`
        : 'Unknown';

    return (
        <div
            ref={containerRef}
            className="min-h-screen anime-detail-page"
            style={accentColor && !isRetro ? { '--anime-accent': accentColor } : { '--anime-accent': 'var(--color-accent)' }}
        >
            <SEOHelmet anime={anime} />

            {/* Modals */}
            {selectedStaff && (
                <StaffModal
                    staffRole={selectedStaff}
                    onClose={() => setSelectedStaff(null)}
                    accentColor={accentColor}
                />
            )}

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
                        <div className="hidden lg:flex lg:flex-col gap-5">
                            <div className="flex-shrink-0">
                                <div className="relative w-44 sm:w-48 lg:w-full aspect-[2/3] overflow-hidden rounded-xl border border-gray-800 bg-dark-200 shadow-xl">
                                    {!isCoverLoaded && (
                                        <div
                                            aria-hidden="true"
                                            className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                                        />
                                    )}
                                    <img
                                        src={coverUrl}
                                        srcSet={coverSrcSet}
                                        sizes="(max-width: 768px) 192px, (max-width: 1024px) 256px, 280px"
                                        alt={anime.title}
                                        onLoad={() => setIsCoverLoaded(true)}
                                        onError={(event) => {
                                            setIsCoverLoaded(false);
                                            applyImageFallback(event, coverFallbackUrl);
                                        }}
                                        className={`w-full h-full object-cover text-transparent transition-opacity duration-700 ease-out ${isCoverLoaded ? 'opacity-100' : 'opacity-0'}`}
                                    />
                                </div>
                            </div>

                            {/* Main Actions - Unified Sidebar Grid */}
                            <div className="space-y-2 w-full" data-title="Tracking Actions">
                                {isAuthenticated ? (
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <StatusSelector
                                                animeId={anime.id}
                                                initialStatus={anime.user_list_status}
                                                onUpdate={handleListUpdate}
                                                totalEpisodes={anime.episode_count}
                                                compactSidebar={true}
                                            />
                                        </div>
                                        <button
                                            onClick={handleFavorite}
                                            title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                                            className={`w-9 h-9 self-start flex justify-center items-center rounded-lg transition-all duration-300
                                                ${isFavorite 
                                                    ? 'bg-red-500/10 text-red-500' 
                                                    : 'bg-dark-100 text-gray-400 hover:text-white'}`}
                                        >
                                            <Heart className={`w-4.5 h-4.5 ${isFavorite ? 'fill-current' : ''}`} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="w-full">
                                        <Link to="/login" className="btn-primary py-2.5 px-6 rounded-lg flex items-center justify-center gap-2 text-sm font-bold w-full shadow-lg">
                                            <Plus className="w-4 h-4" /> Sign In to Track
                                        </Link>
                                    </div>
                                )}
                            </div>

                            <InformationBox anime={anime} accentColor={accentColor} className="hidden lg:flex" />
                            <div className="hidden lg:block">
                                <FriendsWatching animeId={anime.id} accentColor={accentColor} />
                            </div>
                        </div>

                        {/* Column 2: Main Content */}
                        <div className="flex-1 min-w-0">
                            <div className="text-center lg:text-left mb-8">
                                <div className="lg:hidden mb-8">
                                    <div className="mx-auto flex max-w-[330px] items-end gap-4">
                                        <div className="w-[118px] flex-shrink-0">
                                            <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-gray-800 bg-dark-200 shadow-xl">
                                                {!isCoverLoaded && (
                                                    <div
                                                        aria-hidden="true"
                                                        className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                                                    />
                                                )}
                                                <img
                                                    src={coverUrl}
                                                    srcSet={coverSrcSet}
                                                    sizes="118px"
                                                    alt={anime.title}
                                                    onLoad={() => setIsCoverLoaded(true)}
                                                    onError={(event) => {
                                                        setIsCoverLoaded(false);
                                                        applyImageFallback(event, coverFallbackUrl);
                                                    }}
                                                    className={`w-full h-full object-cover text-transparent transition-opacity duration-700 ease-out ${isCoverLoaded ? 'opacity-100' : 'opacity-0'}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="space-y-3" data-title="Mobile Tracking Actions">
                                                {isAuthenticated ? (
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <StatusSelector
                                                                animeId={anime.id}
                                                                initialStatus={anime.user_list_status}
                                                                onUpdate={handleListUpdate}
                                                                totalEpisodes={anime.episode_count}
                                                                compactSidebar={true}
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={handleFavorite}
                                                            title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                                                            className={`w-9 h-9 flex justify-center items-center rounded-lg transition-all duration-300
                                                                ${isFavorite
                                                                    ? 'bg-red-500/10 text-red-500'
                                                                    : 'bg-dark-100 text-gray-400 hover:text-white'}`}
                                                        >
                                                            <Heart className={`w-4.5 h-4.5 ${isFavorite ? 'fill-current' : ''}`} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="w-full">
                                                        <Link to="/login" className="btn-primary py-2.5 px-6 rounded-lg flex items-center justify-center gap-2 text-sm font-bold w-full shadow-lg">
                                                            <Plus className="w-4 h-4" /> Sign In to Track
                                                        </Link>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 sm:gap-3 lg:items-end lg:gap-4 mb-2 min-w-0">
                                    <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold text-gray-300 tracking-tight leading-tight sm:leading-none text-center lg:text-left w-full lg:w-auto break-words">
                                        {anime.title}
                                    </h1>
                                </div>
                                {anime.synopsis && (
                                    <div className="text-left mb-8">
                                        <div className={`relative transition-all duration-500 ease-in-out ${!synopsisExpanded ? 'max-h-[140px] overflow-hidden' : 'max-h-[none]'}`}>
                                            {anime.synopsis.split('\n').filter(p => p.trim()).map((para, i) => (
                                                <p key={i} className="text-gray-200 font-medium leading-relaxed text-sm lg:text-base max-w-4xl mb-4 last:mb-0">
                                                    {para}
                                                </p>
                                            ))}
                                            {anime.synopsis.length > 300 && !synopsisExpanded && (
                                                <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-dark via-dark/60 to-transparent pointer-events-none" />
                                            )}
                                        </div>
                                        {anime.synopsis.length > 300 && (
                                            <button
                                                onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                                                className={`mt-2 flex items-center gap-1.5 text-xs lg:text-sm font-bold transition-all active:scale-95 ${synopsisExpanded ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
                                                style={{ color: mappedAccent }}
                                            >
                                                {synopsisExpanded ? 'Show Less' : 'Read More'}
                                                <ChevronDown className={`w-3.5 h-3.5 lg:w-4 lg:h-4 transition-transform ${synopsisExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                        )}
                                    </div>
                                )}

                                <div className="lg:hidden mt-6 sm:mt-8 mb-8 sm:mb-12 space-y-4 sm:space-y-6">
                                    <InformationBox anime={anime} accentColor={accentColor} />
                                </div>
                            </div>

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
                            <div className="min-h-[300px]">
                                {activeTab === 'overview' && (
                                    <OverviewTab
                                        anime={anime}
                                        accentColor={accentColor}
                                        characters={characters}
                                        staff={staff}
                                        episodes={displayEpisodes}
                                        onStaffClick={setSelectedStaff}
                                    />
                                )}
                                {activeTab === 'watch' && (
                                    <EpisodesTab
                                        anime={anime}
                                        accentColor={accentColor}
                                        episodes={displayEpisodes}
                                        isAuthenticated={isAuthenticated}
                                        totalCount={watchEpisodesTotal}
                                        isLoading={watchEpisodesLoading}
                                        hasError={watchEpisodesIsError}
                                        hasNextPage={hasNextWatchEpisodesPage}
                                        isFetchingNextPage={isFetchingNextWatchEpisodesPage}
                                        ratingPendingEpisodeNumber={
                                            setEpisodeRatingMutation.isPending
                                                ? setEpisodeRatingMutation.variables?.episodeNumber
                                                : clearEpisodeRatingMutation.isPending
                                                    ? clearEpisodeRatingMutation.variables
                                                    : null
                                        }
                                        onRateEpisode={handleEpisodeRatingChange}
                                        onClearEpisodeRating={handleEpisodeRatingClear}
                                        onLoadMore={fetchNextWatchEpisodesPage}
                                        onRetry={refetchWatchEpisodes}
                                    />
                                )}
                                {activeTab === 'themes' && (
                                    <ThemesTab anime={anime} accentColor={accentColor} />
                                )}
                                {activeTab === 'stats' && (
                                    <StatsTab
                                        anime={anime}
                                        accentColor={accentColor}
                                        episodeRatings={episodeRatings || []}
                                        isEpisodeRatingsLoading={episodeRatingsLoading}
                                    />
                                )}
                                {activeTab === 'characters' && (
                                    <CharactersTab
                                        anime={{ ...anime, characters }}
                                        isLoading={charactersLoading}
                                        accentColor={accentColor}
                                        onCharacterClick={(role) => navigate(`/character/${role.character?.id}`)}
                                    />
                                )}
                                {activeTab === 'staff' && (
                                    <StaffTab
                                        anime={{ ...anime, staff }}
                                        isLoading={staffLoading}
                                        accentColor={accentColor}
                                        onStaffClick={setSelectedStaff}
                                    />
                                )}
                            </div>

                            {/* Reviews Section */}
                            <div className="mt-16 mb-16">
                                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-6 flex items-center gap-2 sm:gap-3">
                                        Reviews
                                        <span 
                                            className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                                            style={{ 
                                                color: mappedAccent,
                                                borderColor: mappedAccent ? `${mappedAccent}30` : 'rgba(117,105,141,0.2)',
                                                backgroundColor: mappedAccent ? `${mappedAccent}10` : 'rgba(117,105,141,0.05)'
                                            }}
                                        >
                                            {reviewCount}
                                        </span>
                                    </h2>
                                    <div className="flex items-center gap-3">
                                        <select
                                            value={reviewSort}
                                            onChange={(e) => setReviewSort(e.target.value)}
                                            className="bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
                                        >
                                            <option value="helpful">Most Helpful</option>
                                            <option value="newest">Newest</option>
                                            <option value="highest">Highest Rated</option>
                                            <option value="lowest">Lowest Rated</option>
                                        </select>

                                        {isAuthenticated && !isWritingReview && !editingReview && !userReview && (
                                            canReview ? (
                                                <button
                                                    onClick={() => setIsWritingReview(true)}
                                                    className="text-xs sm:text-sm px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl  text-white font-bold bg-accent"
                                                    style={{
                                                        backgroundColor: accentColor || '#75698d'
                                                    }}
                                                >
                                                    Write a Review
                                                </button>
                                            ) : (
                                                <div className="text-xs text-gray-300 bg-dark-50 px-4 py-2.5 rounded-xl border border-gray-700 ">
                                                    Add to list to write a review
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>

                                {reviewStats && reviewStats.total_reviews > 0 && (
                                    <ReviewSummary
                                        stats={reviewStats}
                                        onFilterByRating={(rating) => setRatingFilter(rating === ratingFilter ? null : rating)}
                                        activeRatingFilter={ratingFilter}
                                        hideSpoilers={hideSpoilersGlobal}
                                        onToggleHideSpoilers={() => setHideSpoilersGlobal(!hideSpoilersGlobal)}
                                        accentColor={accentColor}
                                    />
                                )}

                                {(isWritingReview || editingReview) && (
                                    <div className="mb-12 animate-fade-in">
                                        <ReviewForm
                                            initialData={editingReview}
                                            onSubmit={handleReviewSubmit}
                                            onCancel={() => {
                                                setIsWritingReview(false);
                                                setEditingReview(null);
                                            }}
                                            animeTitle={anime.title}
                                        />
                                    </div>
                                )}

                                <div className="space-y-4">
                                    {reviewsLoading ? (
                                        <div className="text-center py-12">
                                            <Loader className="w-10 h-10 text-accent animate-spin mx-auto" />
                                        </div>
                                    ) : allReviews.length > 0 ? (
                                        <>
                                            {textReviews.map((review) => (
                                                <ReviewCard
                                                    key={review.id}
                                                    review={review}
                                                    onEdit={setEditingReview}
                                                    onDelete={deleteReviewMutation.mutate}
                                                    forceHideSpoilers={hideSpoilersGlobal}
                                                    accentColor={accentColor}
                                                />
                                            ))}

                                            {ratingOnlyReviews.length > 0 && (
                                                <div className="mt-8">
                                                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em] mb-4">
                                                        Rating-only reviews ({ratingOnlyReviews.length})
                                                    </p>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                        {ratingOnlyReviews.map((review) => (
                                                            <ReviewCard
                                                                key={review.id}
                                                                review={review}
                                                                onEdit={setEditingReview}
                                                                onDelete={deleteReviewMutation.mutate}
                                                                compact
                                                                accentColor={accentColor}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {hasNextPage && (
                                                <div className="text-center mt-12">
                                                    <button
                                                        onClick={() => fetchNextPage()}
                                                        disabled={isFetchingNextPage}
                                                        className="btn-secondary text-sm px-8 py-3 rounded-xl"
                                                    >
                                                        {isFetchingNextPage ? <Loader className="w-5 h-5 animate-spin" /> : 'Load More Reviews'}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        !isWritingReview && (
                                            <div className="text-center py-16 bg-dark-100/50 rounded-2xl border border-gray-800 border-dashed">
                                                <p className="text-gray-400 mb-4">No reviews for this anime yet.</p>
                                            </div>
                                        )
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Column 3: Sidebar - Recommendations */}
                        <div className="space-y-6 lg:space-y-8 lg:pt-40">
                            {recommendations && recommendations.length > 0 && (
                                <div>
                                    <h2 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                                        Recommendations
                                    </h2>
                                    <div className="hidden lg:grid grid-cols-1 gap-4">
                                        {recommendations.slice(0, 5).map((rel) => (
                                            <RelatedAnimeCard
                                                key={rel.id}
                                                anime={rel}
                                            />
                                        ))}
                                    </div>
                                    <div className="lg:hidden flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory pl-0 sm:pl-0">
                                        {recommendations.slice(0, 6).map((rel) => (
                                            <MobileRelatedCard
                                                key={rel.id}
                                                anime={rel}
                                            />
                                        ))}
                                    </div>
                                    {recommendations.length > 5 && (
                                        <Link
                                            to={`/browse?genre=${anime.genres?.[0]?.slug || ''}`}
                                            className="block text-center mt-4 sm:mt-6 text-xs font-bold hover:text-white transition-colors py-2 rounded-lg border"
                                            style={{
                                                color: accentColor || '#75698d',
                                                backgroundColor: accentColor ? `${accentColor}10` : 'rgba(117,105,141,0.05)',
                                                borderColor: accentColor ? `${accentColor}1a` : 'rgba(117,105,141,0.1)'
                                            }}
                                        >
                                            FIND MORE TITLES LIKE THIS
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
