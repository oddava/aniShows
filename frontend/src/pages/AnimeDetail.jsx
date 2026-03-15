import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Star, Heart, Plus, Loader, MessageSquare, Film, BarChart3, Users, Mic } from 'lucide-react';
import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { animeApi, favoriteApi, reviewApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import AnimeCard from '../components/AnimeCard';
import StatusSelector from '../components/StatusSelector';
import ReviewCard from '../components/ReviewCard';
import ReviewForm from '../components/ReviewForm';
import ReviewSummary from '../components/ReviewSummary';
import CharacterModal from '../components/CharacterModal';
import StaffModal from '../components/StaffModal';
import StatsTab from '../components/StatsTab';
import InformationBox from '../components/InformationBox';
import FriendsWatching from '../components/FriendsWatching';
import SEOHelmet from '../components/SEOHelmet';
import { OverviewTab, CharactersTab, StaffTab } from '../components/DetailTabs';
import { AnimeDetailSkeleton } from '../components/skeletons';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageSrcSet,
    getOptimizedImageUrl,
} from '../utils/imageUtils';
import logger from '../utils/logger';

// Memoized tab configuration to prevent re-renders
const TABS = [
    { id: 'overview', label: 'Overview', icon: Film },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
    { id: 'characters', label: 'Characters', icon: Users },
    { id: 'staff', label: 'Staff', icon: Mic },
];

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

// Extract and memoize color from image
const useAccentColor = (coverImage, bannerImage) => {
    const [accentColor, setAccentColor] = useState(null);

    useEffect(() => {
        if (!coverImage) return;

        const extractColor = (imageUrl) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';

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
                img.src = imageUrl + (imageUrl.includes('?') ? '&' : '?') + '_cb=' + Date.now();
            });
        };

        const processColor = ({ r, g, b }) => {
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            if (luminance > 0.85) {
                setAccentColor(null);
                return;
            }

            let finalR = r, finalG = g, finalB = b;
            if (luminance < 0.25) {
                const lightenFactor = 0.25 / Math.max(luminance, 0.01);
                finalR = Math.min(255, Math.round(r * lightenFactor));
                finalG = Math.min(255, Math.round(g * lightenFactor));
                finalB = Math.min(255, Math.round(b * lightenFactor));
            }

            const toHex = (c) => c.toString(16).padStart(2, '0');
            setAccentColor(`#${toHex(finalR)}${toHex(finalG)}${toHex(finalB)}`);
        };

        extractColor(coverImage)
            .then(processColor)
            .catch(() => {
                if (bannerImage) {
                    extractColor(bannerImage)
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
const RelatedAnimeCard = memo(({ anime, getImageUrl, accentColor }) => (
    <Link
        to={`/anime/${anime.slug}`}
        className="flex gap-4 group bg-dark-100/30 p-2 rounded-xl border border-transparent hover:border-gray-800 hover:bg-dark-100/50 transition-all"
    >
        <div className="w-20 h-28 flex-shrink-0 overflow-hidden rounded-lg">
            <img
                src={getImageUrl(anime.cover_image)}
                alt={anime.title}
                className="w-full h-full object-cover"
                loading="lazy"
            />
        </div>
        <div className="flex-1 py-1 min-w-0">
            <h3 className="text-gray-200 font-bold text-sm line-clamp-2 transition-colors leading-tight mb-1 group-hover:text-white">
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
));

RelatedAnimeCard.displayName = 'RelatedAnimeCard';

// Memoized mobile related anime card
const MobileRelatedCard = memo(({ anime, getImageUrl }) => (
    <Link
        to={`/anime/${anime.slug}`}
        className="flex-shrink-0 w-28 sm:w-32 snap-start group"
    >
        <div className="aspect-[2/3] rounded-lg overflow-hidden mb-2 border border-gray-800 bg-dark-200">
            <img
                src={getImageUrl(anime.cover_image)}
                alt={anime.title}
                className="w-full h-full object-cover"
                loading="lazy"
            />
        </div>
        <h3 className="text-gray-200 font-bold text-xs line-clamp-2 leading-tight mb-1 group-hover:text-white transition-colors">
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
));

MobileRelatedCard.displayName = 'MobileRelatedCard';

// Memoized tab button component
const TabButton = memo(({ tab, isActive, onClick, accentColor, count }) => {
    const Icon = tab.icon;
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 min-h-[40px] sm:min-h-0
                ${isActive
                    ? 'text-white '
                    : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            style={isActive ? {
                backgroundColor: accentColor || '#8b5cf6'
            } : {}}
        >
            <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {tab.label}
            {count > 0 && (
                <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/20' : 'bg-white/5'}`}>
                    {count}
                </span>
            )}
        </button>
    );
});

TabButton.displayName = 'TabButton';

export default function AnimeDetail() {
    const { slug } = useParams();
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();
    const { theme } = useTheme();
    const isRetro = theme && theme.startsWith('retro-');
    const queryClient = useQueryClient();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isWritingReview, setIsWritingReview] = useState(false);
    const [editingReview, setEditingReview] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [reviewSort, setReviewSort] = useState('helpful');
    const [ratingFilter, setRatingFilter] = useState(null);
    const [hideSpoilersGlobal, setHideSpoilersGlobal] = useState(false);
    const [selectedCharacter, setSelectedCharacter] = useState(null);
    const [selectedStaff, setSelectedStaff] = useState(null);
    const containerRef = useRef(null);

    // Queries
    const { data: anime, isLoading, isError } = useQuery({
        queryKey: ['anime', slug, user?.id],
        queryFn: () => animeApi.getBySlug(slug).then(res => res.data),
        staleTime: 300000, // 5 minutes
        gcTime: 600000, // 10 minutes
    });

    const { data: characters, isLoading: charactersLoading } = useQuery({
        queryKey: ['anime', slug, 'characters'],
        queryFn: () => animeApi.getCharacters(slug).then(res => res.data),
        enabled: !!anime && activeTab === 'characters',
        staleTime: Infinity, // Character lists rarely change
    });

    const { data: staff, isLoading: staffLoading } = useQuery({
        queryKey: ['anime', slug, 'staff'],
        queryFn: () => animeApi.getStaff(slug).then(res => res.data),
        enabled: !!anime && activeTab === 'staff',
        staleTime: Infinity, // Staff lists rarely change
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

    const { data: related } = useQuery({
        queryKey: ['anime', slug, 'related'],
        queryFn: () => animeApi.getRelated(slug).then(res => res.data),
        enabled: !!anime,
    });

    // Derived state
    const accentColor = useAccentColor(anime?.cover_image, anime?.banner_image);
    const handleShare = useShare();

    const allReviews = useMemo(() =>
        reviewsData?.pages.flatMap(page => Array.isArray(page) ? page : (page.results || [])) || [],
        [reviewsData]
    );

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

    // Mutations
    const createReviewMutation = useMutation({
        mutationFn: (data) => reviewApi.create({ ...data, anime_slug: slug }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
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
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
            setEditingReview(null);
        },
    });

    const deleteReviewMutation = useMutation({
        mutationFn: (id) => reviewApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites-overview', user.username] });
            }
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
        queryClient.invalidateQueries({ queryKey: ['anime', slug] });
        queryClient.invalidateQueries({ queryKey: ['lists'] });
        queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
    }, [queryClient, slug]);

    const handleReviewSubmit = useCallback(async (data) => {
        if (editingReview) {
            await updateReviewMutation.mutateAsync({ id: editingReview.id, data });
        } else {
            await createReviewMutation.mutateAsync(data);
        }
    }, [editingReview, updateReviewMutation, createReviewMutation]);

    const handleTabClick = useCallback((tabId) => {
        setActiveTab(tabId);
    }, []);

    // Helpers
    const getImageUrl = useCallback((url) => {
        if (!url) return null;
        let cleanUrl = url;
        if (cleanUrl.includes('localhost:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/localhost:8000/, '');
        }
        if (cleanUrl.includes('web:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/web:8000/, '');
        }
        if (cleanUrl.startsWith('http')) return cleanUrl;
        if (!cleanUrl.startsWith('/')) {
            cleanUrl = `/${cleanUrl}`;
        }
        return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
    }, []);

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
        `https://placehold.co/1920x600/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const coverUrl = getOptimizedImageUrl(anime, 'cover', 'large') ||
        relationCoverFallback ||
        `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const bannerSrcSet = getImageSrcSet(anime, 'banner');
    const coverSrcSet = getImageSrcSet(anime, 'cover');
    const bannerFallbackUrl = getImageFallbackUrl(anime, 'banner');
    const coverFallbackUrl = getImageFallbackUrl(anime, 'cover');

    const tabsWithCounts = TABS.map(tab => ({
        ...tab,
        count: tab.id === 'characters' ? (anime.character_count || 0) :
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
            {selectedCharacter && (
                <CharacterModal
                    role={selectedCharacter}
                    onClose={() => setSelectedCharacter(null)}
                    accentColor={accentColor}
                />
            )}
            {selectedStaff && (
                <StaffModal
                    staffRole={selectedStaff}
                    onClose={() => setSelectedStaff(null)}
                    accentColor={accentColor}
                />
            )}

            {/* Banner */}
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden bg-dark-200">
                <img
                    src={bannerUrl}
                    srcSet={bannerSrcSet}
                    sizes="100vw"
                    alt={anime.title}
                    onError={(event) => applyImageFallback(event, bannerFallbackUrl)}
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent" />
            </div>

            {/* Content Container */}
            <div className="relative -mt-32 px-4 sm:px-6 lg:px-8 pb-16">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-8 min-w-0">
                        {/* Column 1: Poster & Mobile Info */}
                        <div className="flex flex-col gap-6">
                            <div className="flex-shrink-0 mx-auto lg:mx-0">
                                <img
                                    src={coverUrl}
                                    srcSet={coverSrcSet}
                                    sizes="(max-width: 768px) 192px, (max-width: 1024px) 256px, 280px"
                                    alt={anime.title}
                                    onError={(event) => applyImageFallback(event, coverFallbackUrl)}
                                    className="w-48 md:w-64 lg:w-full aspect-[2/3] object-cover rounded-2xl border border-gray-800 bg-dark-200"
                                />
                            </div>

                            <InformationBox anime={anime} accentColor={accentColor} className="hidden lg:flex" />
                            <div className="hidden lg:block">
                                <FriendsWatching animeId={anime.id} accentColor={accentColor} />
                            </div>
                        </div>

                        {/* Column 2: Main Content */}
                        <div className="flex-1 min-w-0">
                            <div className="text-center lg:text-left mb-8">
                                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 sm:gap-3 lg:items-end lg:gap-4 mb-2 min-w-0">
                                    <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold text-white/90 tracking-tight leading-tight sm:leading-none text-center lg:text-left w-full lg:w-auto break-words">
                                        {anime.title}
                                    </h1>
                                </div>
                                {anime.title_jp && (
                                    <p className="text-gray-400 text-lg mb-6 font-medium tracking-wide">{anime.title_jp}</p>
                                )}

                                {/* Genres */}
                                <div className="flex flex-wrap justify-center lg:justify-start gap-1.5 sm:gap-2 mb-6 sm:mb-8">
                                    {anime.genres?.map((genre) => (
                                        <Link
                                            key={genre.id}
                                            to={`/browse?genre=${genre.slug}`}
                                            className="px-4 py-1.5 bg-dark-100 text-gray-300 rounded-full text-xs font-bold border border-gray-700 hover:text-white transition-all "
                                            style={{ '--hover-bg': mappedAccent }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = mappedAccent;
                                                e.currentTarget.style.borderColor = mappedAccent;
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = '';
                                                e.currentTarget.style.borderColor = '';
                                            }}
                                        >
                                            {genre.name}
                                        </Link>
                                    ))}
                                </div>

                                {/* Main Actions */}
                                <div className={`flex flex-col gap-3 sm:gap-4 md:gap-5 p-3 sm:p-4 md:p-6 rounded-2xl sm:rounded-3xl border relative z-20 ${isRetro ? 'retro-window !rounded-none !bg-dark-100 !backdrop-blur-none border-t-0 pb-6' : 'bg-dark-100 border-dark-50'}`}
                                    data-title="Tracking Actions"
                                >
                                    {isAuthenticated ? (
                                        <>
                                            {/* Top Row: Watch Time & Actions */}
                                            <div className={`flex items-center justify-between gap-3 sm:gap-4 ${isRetro ? 'mt-4' : ''}`}>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-0.5 sm:mb-1">Watch Time</span>
                                                    <span className="text-xs sm:text-sm md:text-base font-black text-white whitespace-nowrap">
                                                        {watchTimeLabel}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 sm:gap-2">
                                                    <button
                                                        onClick={handleFavorite}
                                                        title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                                                        className={`p-2.5 sm:p-3 md:p-3.5 rounded-lg sm:rounded-xl md:rounded-2xl border transition-all duration-300 group flex-shrink-0
                                                            ${isFavorite
                                                                ? 'bg-red-500 border-red-500 text-white  '
                                                                : 'bg-dark-200 border-gray-700 text-gray-400 hover:border-red-500/50 hover:text-red-500'}`}
                                                    >
                                                        <Heart className={`w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 ${isFavorite ? 'fill-current' : ''}`} />
                                                    </button>

                                                    <button
                                                        onClick={handleShare}
                                                        title="Share Anime"
                                                        className="p-2.5 sm:p-3 md:p-3.5 rounded-lg sm:rounded-xl md:rounded-2xl border border-gray-700 bg-dark-200 text-gray-400 hover:border-accent/50 hover:text-accent transition-all duration-300  flex-shrink-0"
                                                    >
                                                        <svg className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Bottom Row: Progress Tracker */}
                                            <div className="w-full border-t border-gray-800/50 pt-3 sm:pt-4">
                                                <StatusSelector
                                                    animeId={anime.id}
                                                    initialStatus={anime.user_list_status}
                                                    onUpdate={handleListUpdate}
                                                    totalEpisodes={anime.episode_count}
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex-1 w-full">
                                            <Link to="/login" className="btn-primary w-full py-2.5 sm:py-3 md:py-4 text-center rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 sm:gap-3 text-sm sm:text-base">
                                                <Plus className="w-4 h-4 sm:w-5 sm:h-5" /> Sign In to Track Progress
                                            </Link>
                                        </div>
                                    )}
                                </div>

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
                                        onClick={() => handleTabClick(tab.id)}
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
                                    />
                                )}
                                {activeTab === 'stats' && (
                                    <StatsTab anime={anime} accentColor={accentColor} />
                                )}
                                {activeTab === 'characters' && (
                                    <CharactersTab
                                        anime={{ ...anime, characters }}
                                        isLoading={charactersLoading}
                                        accentColor={accentColor}
                                        onCharacterClick={setSelectedCharacter}
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
                                    <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
                                        <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: accentColor || '#8b5cf6' }} />
                                        Reviews
                                        <span className="text-xs sm:text-sm font-normal text-gray-400 bg-dark-50 px-2 sm:px-3 py-1 rounded-full border border-gray-800">
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
                                                        backgroundColor: accentColor || '#8b5cf6'
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
                                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
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
                                                <MessageSquare className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                                                <p className="text-gray-400 mb-4">No reviews for this anime yet.</p>
                                            </div>
                                        )
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Column 3: Sidebar - Recommendations */}
                        <div className="space-y-6 lg:space-y-8 lg:pt-40">
                            {related && related.length > 0 && (
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold text-white mb-4 sm:mb-6 flex items-center gap-2">
                                        <div className="w-1 h-5 sm:h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                                        Recommendations
                                    </h2>
                                    <div className="hidden lg:grid grid-cols-1 gap-4">
                                        {related.slice(0, 5).map((rel) => (
                                            <RelatedAnimeCard
                                                key={rel.id}
                                                anime={rel}
                                                getImageUrl={getImageUrl}
                                                accentColor={accentColor}
                                            />
                                        ))}
                                    </div>
                                    <div className="lg:hidden flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory pl-0 sm:pl-0">
                                        {related.slice(0, 6).map((rel) => (
                                            <MobileRelatedCard
                                                key={rel.id}
                                                anime={rel}
                                                getImageUrl={getImageUrl}
                                            />
                                        ))}
                                    </div>
                                    {related.length > 5 && (
                                        <Link
                                            to={`/browse?genre=${anime.genres?.[0]?.slug || ''}`}
                                            className="block text-center mt-4 sm:mt-6 text-xs font-bold hover:text-white transition-colors py-2 rounded-lg border"
                                            style={{
                                                color: accentColor || '#8b5cf6',
                                                backgroundColor: accentColor ? `${accentColor}10` : 'rgba(139,92,246,0.05)',
                                                borderColor: accentColor ? `${accentColor}1a` : 'rgba(139,92,246,0.1)'
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
