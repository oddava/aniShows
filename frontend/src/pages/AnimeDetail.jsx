import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Star, Heart, Play, Calendar, Clock, Tv, MessageSquare, Loader, Plus, Trophy, TrendingUp, ExternalLink, Users, Mic, Film, ChevronDown, Hash, Building2, Bell, BookOpen, BarChart3, Music } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { animeApi, favoriteApi, reviewApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import StatusSelector from '../components/StatusSelector';
import ReviewCard from '../components/ReviewCard';
import ReviewForm from '../components/ReviewForm';
import ReviewSummary from '../components/ReviewSummary';
import CharacterModal from '../components/CharacterModal';
import StaffModal from '../components/StaffModal';
import StatsTab from '../components/StatsTab';
import FranchiseSection from '../components/FranchiseSection';
import FriendsWatching from '../components/FriendsWatching';
import MusicSection from '../components/MusicSection';
import SEOHelmet from '../components/SEOHelmet';
import { AnimeDetailSkeleton } from '../components/skeletons';
import { formatRelativeTime, formatAiringTime, isWithin24Hours } from '../utils/dateUtils';
import { getOptimizedImageUrl, getImageSrcSet } from '../utils/imageUtils';
import useDelayedLoading from '../hooks/useDelayedLoading';
import logger from '../utils/logger';

const InformationBox = ({ anime, className, accentColor }) => {
    const formatDateRange = () => {
        if (!anime.release_date) return 'Unknown';
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const startStr = new Date(anime.release_date).toLocaleDateString('en-US', options);

        if (anime.status === 'Airing' && !anime.end_date) {
            return (
                <div className="flex flex-col items-end leading-tight">
                    <span>{startStr}</span>
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest my-1">to</span>
                    <span style={{ color: accentColor || '#8b5cf6' }}>Present</span>
                </div>
            );
        }

        if (anime.end_date) {
            const endStr = new Date(anime.end_date).toLocaleDateString('en-US', options);
            if (startStr === endStr) return startStr;
            return (
                <div className="flex flex-col items-end leading-tight">
                    <span>{startStr}</span>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest my-1">to</span>
                    <span>{endStr}</span>
                </div>
            );
        }

        return startStr;
    };

    return (
        <div className={`flex flex-col gap-6 bg-dark-100/50 p-6 rounded-2xl border border-gray-800 shadow-xl min-w-0 overflow-hidden ${className}`}>
            <h3
                className="text-white font-bold uppercase text-[10px] tracking-[0.2em]"
                style={{ color: accentColor ? `${accentColor}cc` : '#8b5cf6cc' }}
            >
                Information
            </h3>
            <div className="space-y-4">
                <InfoRow icon={Tv} label="Type" value={anime.anime_type} />
                <InfoRow icon={Hash} label="Episodes" value={anime.episode_count || 'Unknown'} />

                {/* Duration */}
                {anime.duration_minutes > 0 && (
                    <InfoRow icon={Clock} label="Duration" value={`${anime.duration_minutes} min`} />
                )}

                {/* Aired Date */}
                {anime.release_date && (
                    <InfoRow icon={Calendar} label="Aired" value={formatDateRange()} />
                )}

                {/* Season */}
                {(anime.season || anime.season_year) && (
                    <InfoRow
                        icon={Calendar}
                        label="Season"
                        value={`${anime.season || ''} ${anime.season_year || ''}`.trim()}
                    />
                )}

                {/* Source Material */}
                {anime.source_material && (
                    <InfoRow icon={BookOpen} label="Source" value={anime.source_material} />
                )}

                {/* Studio */}
                {anime.studio && (
                    <InfoRow icon={Building2} label="Studio" value={anime.studio.name} />
                )}

                {/* Member Count */}
                {anime.member_count > 0 && (
                    <InfoRow icon={Users} label="Members" value={anime.member_count.toLocaleString()} />
                )}

                {/* Next Episode Section - for airing anime */}
                {anime.status === 'Airing' && anime.next_airing_episode && anime.next_airing_date && (
                    <div className="pt-4 mt-4 border-t border-white/10">
                        <div
                            className="p-4 rounded-xl border"
                            style={{
                                backgroundColor: isWithin24Hours(anime.next_airing_date)
                                    ? 'rgba(34, 197, 94, 0.1)'
                                    : (accentColor ? `${accentColor}15` : 'rgba(139, 92, 246, 0.1)'),
                                borderColor: isWithin24Hours(anime.next_airing_date)
                                    ? 'rgba(34, 197, 94, 0.3)'
                                    : (accentColor ? `${accentColor}30` : 'rgba(139, 92, 246, 0.2)')
                            }}
                        >
                            <div className="flex items-center gap-2 mb-3">
                                <Bell
                                    className="w-4 h-4"
                                    style={{
                                        color: isWithin24Hours(anime.next_airing_date)
                                            ? '#22c55e'
                                            : (accentColor || '#8b5cf6')
                                    }}
                                />
                                <span
                                    className="text-[10px] font-black uppercase tracking-widest"
                                    style={{
                                        color: isWithin24Hours(anime.next_airing_date)
                                            ? '#22c55e'
                                            : (accentColor || '#8b5cf6')
                                    }}
                                >
                                    Next Episode
                                </span>
                            </div>
                            <div className="space-y-1">
                                <p className="text-white font-bold text-lg">
                                    Episode {anime.next_airing_episode}
                                </p>
                                <p
                                    className="text-sm font-semibold"
                                    style={{
                                        color: isWithin24Hours(anime.next_airing_date)
                                            ? '#22c55e'
                                            : (accentColor || '#8b5cf6')
                                    }}
                                >
                                    {formatRelativeTime(anime.next_airing_date)}
                                </p>
                                <p className="text-gray-400 text-xs">
                                    {formatAiringTime(anime.next_airing_date)}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* External Links */}
                {anime.external_links && anime.external_links.length > 0 && (
                    <div className="pt-6 mt-8 border-t border-white/5">
                        <p className="text-gray-300 text-xs font-bold uppercase tracking-wider mb-3">External Links</p>
                        <div className="flex flex-wrap gap-2">
                            {anime.external_links.map((link, i) => (
                                <a
                                    key={i}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 border ${['Official Site', 'Netflix', 'Crunchyroll', 'Twitter'].includes(link.site)
                                        ? 'bg-transparent hover:text-white'
                                        : 'bg-dark-200 hover:bg-white text-gray-300 hover:text-black border-gray-700/50 hover:border-white'
                                        }`}
                                    style={['Official Site', 'Netflix', 'Crunchyroll', 'Twitter'].includes(link.site) ? {
                                        color: accentColor || '#8b5cf6',
                                        borderColor: accentColor ? `${accentColor}80` : 'rgba(139,92,246,0.5)'
                                    } : {}}
                                    onMouseEnter={(e) => {
                                        if (['Official Site', 'Netflix', 'Crunchyroll', 'Twitter'].includes(link.site)) {
                                            e.currentTarget.style.backgroundColor = accentColor || '#8b5cf6';
                                            e.currentTarget.style.color = 'white';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (['Official Site', 'Netflix', 'Crunchyroll', 'Twitter'].includes(link.site)) {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                            e.currentTarget.style.color = accentColor || '#8b5cf6';
                                        }
                                    }}
                                >
                                    {link.site} <ExternalLink className="w-3 h-3" />
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const InfoRow = ({ icon: Icon, label, value }) => (  // eslint-disable-line no-unused-vars
    <div className="flex items-start justify-between gap-4 py-1 min-w-0">
        <div className="flex items-center gap-2 pt-1 shrink-0">
            <Icon className="w-3.5 h-3.5 text-gray-500" />
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-wider">
                {label}
            </p>
        </div>
        <div className="text-white font-bold text-sm text-right leading-relaxed break-words min-w-0 max-w-[60%]">
            {value}
        </div>
    </div>
);

export default function AnimeDetail() {
    const { slug } = useParams();
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isWritingReview, setIsWritingReview] = useState(false);
    const [editingReview, setEditingReview] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [accentColor, setAccentColor] = useState(null);
    const [synopsisExpanded, setSynopsisExpanded] = useState(false);
    const [reviewSort, setReviewSort] = useState('helpful');
    const [ratingFilter, setRatingFilter] = useState(null);
    const [hideSpoilersGlobal, setHideSpoilersGlobal] = useState(false);
    const [selectedCharacter, setSelectedCharacter] = useState(null);
    const [selectedStaff, setSelectedStaff] = useState(null);
    const containerRef = useRef(null);

    const { data: anime, isLoading, isError } = useQuery({
        queryKey: ['anime', slug, user?.id],
        queryFn: () => animeApi.getBySlug(slug).then(res => res.data),
        refetchOnMount: 'always',
        staleTime: 0,
    });

    const {
        data: reviewsData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: reviewsLoading,
        refetch: refetchReviews
    } = useInfiniteQuery({
        queryKey: ['reviews', slug, reviewSort, ratingFilter],
        queryFn: ({ pageParam }) => reviewApi.getAll({
            anime: slug,
            page: pageParam,
            sort: reviewSort,
            rating: ratingFilter
        }).then(res => res.data),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage && lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch { return undefined; }
            }
            return undefined;
        },
        enabled: !!slug
    });

    const showSkeleton = useDelayedLoading(isLoading, 200);

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

    const allReviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    const textReviews = allReviews.filter(r => r.text && r.text.trim().length > 0);
    const ratingOnlyReviews = allReviews.filter(r => !r.text || r.text.trim().length === 0);
    const reviewCount = reviewsData?.pages[0]?.count ?? anime?.review_count ?? allReviews.length;

    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
        }
    }, [anime]);

    useEffect(() => {
        if (!anime?.cover_image) return;

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

                img.onerror = () => {
                    reject(new Error('Failed to load image'));
                };

                // Add cache buster to avoid cached images without CORS headers
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

            const toHex = (c) => {
                const hex = c.toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            };
            setAccentColor(`#${toHex(finalR)}${toHex(finalG)}${toHex(finalB)}`);
        };

        // Try cover image first, then banner as fallback
        extractColor(anime.cover_image)
            .then(processColor)
            .catch((err) => {
                logger.warn('Cover image color extraction failed:', err);
                if (anime.banner_image) {
                    extractColor(anime.banner_image)
                        .then(processColor)
                        .catch((err2) => {
                            logger.warn('Banner image color extraction failed:', err2);
                            setAccentColor(null);
                        });
                } else {
                    setAccentColor(null);
                }
            });
    }, [anime?.cover_image, anime?.banner_image]);

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
            }
        },
    });

    const handleFavorite = async () => {
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
    };

    const handleListUpdate = () => {
        queryClient.invalidateQueries({ queryKey: ['anime', slug] });
        queryClient.invalidateQueries({ queryKey: ['lists'] });
        queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
    };

    const handleReviewSubmit = async (data) => {
        if (editingReview) {
            await updateReviewMutation.mutateAsync({ id: editingReview.id, data });
        } else {
            await createReviewMutation.mutateAsync(data);
        }
    };

    const userReview = anime?.user_review || allReviews.find(r => r.user?.username === user?.username);
    const canReview = isAuthenticated && anime?.user_list_status != null;

    if (isLoading) {
        if (showSkeleton) {
            return <AnimeDetailSkeleton />;
        }
        return <div className="min-h-screen bg-dark" />; // Prevent flash before skeleton shows
    }

    if (isError || !anime) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center">
                <p className="text-gray-400 mb-4">Anime not found</p>
                <Link to="/browse" className="btn-primary">Browse Anime</Link>
            </div>
        );
    }

    const getImageUrl = (url) => {
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
    };

    const bannerUrl = getOptimizedImageUrl(anime, 'banner', 'large') || getOptimizedImageUrl(anime, 'cover', 'large') || `https://placehold.co/1920x600/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const coverUrl = getOptimizedImageUrl(anime, 'cover', 'large') || `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const bannerSrcSet = getImageSrcSet(anime, 'banner');
    const coverSrcSet = getImageSrcSet(anime, 'cover');

    const tabs = [
        { id: 'overview', label: 'Overview', icon: Film },
        { id: 'stats', label: 'Stats', icon: BarChart3 },
        { id: 'characters', label: 'Characters', icon: Users, count: anime.characters?.length },
        { id: 'staff', label: 'Staff', icon: Mic, count: anime.staff?.length },
    ];

    return (
        <div
            ref={containerRef}
            className="min-h-screen"
            style={accentColor ? { '--anime-accent': accentColor } : {}}
        >
            <SEOHelmet anime={anime} />

            {/* Character Modal */}
            {selectedCharacter && (
                <CharacterModal
                    role={selectedCharacter}
                    onClose={() => setSelectedCharacter(null)}
                    accentColor={accentColor}
                />
            )}

            {/* Staff Modal */}
            {selectedStaff && (
                <StaffModal
                    staffRole={selectedStaff}
                    onClose={() => setSelectedStaff(null)}
                    accentColor={accentColor}
                />
            )}

            {/* Banner */}
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden">
                <img
                    src={bannerUrl}
                    srcSet={bannerSrcSet}
                    sizes="100vw"
                    alt={anime.title}
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
                                    className="w-48 md:w-64 lg:w-full rounded-2xl shadow-2xl border border-gray-800"
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
                                    <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight sm:leading-none text-center lg:text-left w-full lg:w-auto break-words">
                                        {anime.title}
                                    </h1>

                                </div>
                                {anime.title_jp && (
                                    <p className="text-gray-400 text-lg mb-6 font-medium tracking-wide">{anime.title_jp}</p>
                                )}

                                <div className="flex flex-wrap justify-center lg:justify-start gap-1.5 sm:gap-2 mb-6 sm:mb-8">
                                    {anime.genres?.map((genre) => (
                                        <Link
                                            key={genre.id}
                                            to={`/browse?genre=${genre.slug}`}
                                            className="px-4 py-1.5 bg-dark-100 text-gray-300 rounded-full text-xs font-bold border border-gray-700 hover:text-white transition-all shadow-sm"
                                            style={{
                                                '--hover-bg': accentColor || '#8b5cf6',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = accentColor || '#8b5cf6';
                                                e.currentTarget.style.borderColor = accentColor || '#8b5cf6';
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
                                <div className="flex flex-col gap-3 sm:gap-4 md:gap-5 bg-dark-100/40 p-3 sm:p-4 md:p-6 rounded-2xl sm:rounded-3xl border border-gray-800/50 shadow-2xl backdrop-blur-md relative z-20">
                                    {isAuthenticated ? (
                                        <>
                                            {/* Top Row: Watch Time & Actions */}
                                            <div className="flex items-center justify-between gap-3 sm:gap-4">
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-0.5 sm:mb-1">Watch Time</span>
                                                    <span className="text-xs sm:text-sm md:text-base font-black text-white whitespace-nowrap">
                                                        {anime.episode_count ? (() => {
                                                            const duration = anime.duration_minutes || 24;
                                                            const totalMinutes = anime.episode_count * duration;
                                                            const hours = Math.floor(totalMinutes / 60);
                                                            const minutes = totalMinutes % 60;
                                                            return `${hours}h ${minutes}m`;
                                                        })() : 'N/A'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 sm:gap-2">
                                                    <button
                                                        onClick={handleFavorite}
                                                        title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                                                        className={`p-2.5 sm:p-3 md:p-3.5 rounded-lg sm:rounded-xl md:rounded-2xl border transition-all duration-300 group flex-shrink-0
                                                            ${isFavorite
                                                                ? 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/20'
                                                                : 'bg-dark-200 border-gray-700 text-gray-400 hover:border-red-500/50 hover:text-red-500'}`}
                                                    >
                                                        <Heart className={`w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 transition-transform group-hover:scale-110 ${isFavorite ? 'fill-current' : ''}`} />
                                                    </button>

                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(window.location.href);
                                                            alert('Link copied to clipboard!');
                                                        }}
                                                        title="Share Anime"
                                                        className="p-2.5 sm:p-3 md:p-3.5 rounded-lg sm:rounded-xl md:rounded-2xl border border-gray-700 bg-dark-200 text-gray-400 hover:border-accent/50 hover:text-accent transition-all duration-300 active:scale-95 flex-shrink-0"
                                                    >
                                                        <svg className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Bottom Row: Progress Tracker - Full Width */}
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
                            <div className="flex items-center gap-1.5 sm:gap-2 mb-6 sm:mb-10 p-1.5 bg-dark-100/60 backdrop-blur-md rounded-xl sm:rounded-2xl border border-white/5 overflow-x-auto scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-1.5">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 whitespace-nowrap flex-shrink-0 min-h-[40px] sm:min-h-0
                                            ${activeTab === tab.id
                                                ? 'text-white shadow-lg'
                                                : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                        style={activeTab === tab.id ? {
                                            backgroundColor: accentColor || '#8b5cf6',
                                            boxShadow: `0 10px 25px -5px ${accentColor || '#8b5cf6'}40`
                                        } : {}}
                                    >
                                        <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                        {tab.label}
                                        {tab.count > 0 && (
                                            <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-md ${activeTab === tab.id ? 'bg-white/20' : 'bg-white/5'}`}>
                                                {tab.count}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="min-h-[300px]">
                                {activeTab === 'overview' && (
                                    <OverviewTab
                                        anime={anime}
                                        related={related}
                                        accentColor={accentColor}
                                    />
                                )}

                                {activeTab === 'stats' && (
                                    <StatsTab anime={anime} accentColor={accentColor} />
                                )}

                                {activeTab === 'characters' && (
                                    <CharactersTab
                                        anime={anime}
                                        accentColor={accentColor}
                                        onCharacterClick={setSelectedCharacter}
                                    />
                                )}

                                {activeTab === 'staff' && (
                                    <StaffTab
                                        anime={anime}
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
                                                    className="text-xs sm:text-sm px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl shadow-lg text-white font-bold"
                                                    style={{
                                                        backgroundColor: accentColor || '#8b5cf6',
                                                        boxShadow: `0 10px 25px -5px ${accentColor || '#8b5cf6'}40`
                                                    }}
                                                >
                                                    Write a Review
                                                </button>
                                            ) : (
                                                <div className="text-xs text-gray-300 bg-dark-50 px-4 py-2.5 rounded-xl border border-gray-700 shadow-inner">
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
                                        {related.slice(0, 5).map((anime) => (
                                            <Link
                                                key={anime.id}
                                                to={`/anime/${anime.slug}`}
                                                className="flex gap-4 group bg-dark-100/30 p-2 rounded-xl border border-transparent hover:border-gray-800 hover:bg-dark-100/50 transition-all"
                                            >
                                                <div className="w-20 h-28 flex-shrink-0 overflow-hidden rounded-lg">
                                                    <img
                                                        src={getImageUrl(anime.cover_image)}
                                                        alt={anime.title}
                                                        className="w-full h-full object-cover transition-transform group-hover:scale-110"
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
                                        ))}
                                    </div>
                                    <div className="lg:hidden flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory pl-0 sm:pl-0">
                                        {related.slice(0, 6).map((anime) => (
                                            <Link
                                                key={anime.id}
                                                to={`/anime/${anime.slug}`}
                                                className="flex-shrink-0 w-28 sm:w-32 snap-start group"
                                            >
                                                <div className="aspect-[2/3] rounded-lg overflow-hidden mb-2 border border-gray-800 bg-dark-200">
                                                    <img
                                                        src={getImageUrl(anime.cover_image)}
                                                        alt={anime.title}
                                                        className="w-full h-full object-cover transition-transform group-hover:scale-110"
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

// Tab Components
function OverviewTab({ anime, accentColor }) {  // eslint-disable-line no-unused-vars
    const [synopsisExpanded, setSynopsisExpanded] = useState(false);

    return (
        <div key="overview" className="animate-tab-content space-y-12">
            <FranchiseSection relations={anime.relations} accentColor={accentColor} sourceSlug={anime.slug} />

            <MusicSection anime={anime} accentColor={accentColor} />

            <div className="mb-12">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                    Synopsis
                </h2>
                <div className="relative">
                    <p className={`text-gray-300 leading-loose text-lg font-normal max-w-4xl transition-all duration-300 ${!synopsisExpanded ? 'line-clamp-4' : ''}`}>
                        {anime.synopsis}
                    </p>
                    {anime.synopsis && anime.synopsis.length > 400 && (
                        <>
                            {!synopsisExpanded && (
                                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-dark to-transparent pointer-events-none" />
                            )}
                            <button
                                onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                                className="mt-2 flex items-center gap-1 text-sm font-bold transition-colors"
                                style={{ color: accentColor || '#8b5cf6' }}
                            >
                                {synopsisExpanded ? 'Show Less' : 'Read More'}
                                <ChevronDown className={`w-4 h-4 transition-transform ${synopsisExpanded ? 'rotate-180' : ''}`} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {anime.trailer_url && (() => {
                const getYouTubeId = (url) => {
                    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
                    return match ? match[1] : null;
                };
                const videoId = getYouTubeId(anime.trailer_url);
                if (!videoId) return null;
                return (
                    <div className="mb-12">
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                            Trailer
                        </h2>
                        <div className="relative rounded-2xl overflow-hidden border border-gray-800 aspect-video shadow-2xl">
                            <iframe
                                src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`}
                                title="Trailer"
                                frameBorder="0"
                                allow="fullscreen"
                                allowFullScreen
                                sandbox="allow-scripts allow-same-origin allow-presentation"
                                loading="lazy"
                                className="absolute inset-0 w-full h-full"
                            />
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

function CharactersTab({ anime, accentColor, onCharacterClick }) {
    if (!anime.characters || anime.characters.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Users className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No character information available.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 animate-tab-content">
            {anime.characters.map((role) => (
                <div
                    key={role.id}
                    onClick={() => onCharacterClick(role)}
                    className="group relative h-40 sm:h-48 md:h-56 lg:h-64 overflow-hidden rounded-lg sm:rounded-xl lg:rounded-2xl border border-white/5 bg-dark-200/40 cursor-pointer hover:border-gray-600 transition-colors"
                >
                    <div className="absolute inset-0">
                        <img
                            src={role.character.image || '/placeholder-avatar.png'}
                            alt={role.character.name}
                            loading="lazy"
                            className="h-full w-full object-cover opacity-70"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/80 to-transparent" />
                    </div>
                    <div className="relative h-full flex flex-col justify-end p-4 z-10">
                        <div className="absolute top-3 right-3">
                            <span
                                className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-lg border backdrop-blur-md
                                    ${role.role === 'MAIN'
                                        ? 'text-white'
                                        : 'bg-white/5 border-white/10 text-gray-400'}`}
                                style={role.role === 'MAIN' ? {
                                    backgroundColor: accentColor ? `${accentColor}30` : 'rgba(139,92,246,0.2)',
                                    borderColor: accentColor ? `${accentColor}50` : 'rgba(139,92,246,0.3)',
                                    color: accentColor || '#8b5cf6'
                                } : {}}
                            >
                                {role.role}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white leading-tight mb-1">
                                {role.character.name}
                            </h3>
                            {role.voice_actor && (
                                <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-white/10">
                                    <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 lg:w-9 lg:h-9 shrink-0">
                                        <img
                                            src={role.voice_actor.image || '/placeholder-avatar.png'}
                                            alt={role.voice_actor.name}
                                            loading="lazy"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-300 leading-tight">
                                            {role.voice_actor.name}
                                        </p>
                                        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mt-0.5">
                                            Japanese
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function StaffTab({ anime, accentColor, onStaffClick }) {
    if (!anime.staff || anime.staff.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Mic className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No staff information available.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-tab-content">
            {anime.staff.map((staffRole) => (
                <div
                    key={staffRole.id}
                    onClick={() => onStaffClick(staffRole)}
                    className="flex flex-col items-center text-center p-6 bg-dark-100/30 rounded-xl border border-gray-800/50 hover:bg-dark-100/50 transition-colors cursor-pointer group"
                >
                    <div className="w-20 h-20 rounded-full overflow-hidden border border-gray-700 mb-4 shadow-lg group-hover:border-gray-600 transition-colors">
                        <img
                            src={staffRole.staff.image || '/placeholder-avatar.png'}
                            alt={staffRole.staff.name}
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <h4 className="font-bold text-white text-sm line-clamp-2 mb-1">{staffRole.staff.name}</h4>
                    <p className="text-xs text-gray-500 line-clamp-1">{staffRole.role}</p>
                </div>
            ))}
        </div>
    );
}
