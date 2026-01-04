import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Star, Heart, Play, Calendar, Clock, Tv, MessageSquare, Loader, Plus, Trophy, TrendingUp, ExternalLink, Users, Mic, Film, ChevronDown, Hash, Building2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { animeApi, favoriteApi, reviewApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import StatusSelector from '../components/StatusSelector';
import ReviewCard from '../components/ReviewCard';
import ReviewForm from '../components/ReviewForm';

const InformationBox = ({ anime, className, accentColor }) => (
    <div className={`flex flex-col gap-6 bg-dark-100/50 p-6 rounded-2xl border border-gray-800 shadow-xl ${className}`}>
        <h3
            className="text-white font-bold uppercase text-[10px] tracking-[0.2em]"
            style={{ color: accentColor ? `${accentColor}cc` : '#8b5cf6cc' }}
        >
            Information
        </h3>
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <p className="text-gray-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <Tv className="w-3 h-3 text-gray-500" />
                    Type
                </p>
                <div className="flex-1 border-b border-white/5 border-dotted mt-1" />
                <p className="text-white font-semibold text-sm">
                    {anime.anime_type}
                </p>
            </div>
            <div className="flex items-center justify-between gap-4">
                <p className="text-gray-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <Hash className="w-3 h-3 text-gray-500" />
                    Episodes
                </p>
                <div className="flex-1 border-b border-white/5 border-dotted mt-1" />
                <p className="text-white font-semibold text-sm">
                    {anime.episode_count || 'Unknown'}
                </p>
            </div>
            {anime.release_date && (
                <div className="flex items-center justify-between gap-4">
                    <p className="text-gray-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-3 h-3 text-gray-500" />
                        Aired
                    </p>
                    <div className="flex-1 border-b border-white/5 border-dotted mt-1" />
                    <p className="text-white font-semibold text-sm">
                        {new Date(anime.release_date).getFullYear()}
                    </p>
                </div>
            )}
            {anime.studio && (
                <div className="flex items-center justify-between gap-4 mb-3">
                    <p className="text-gray-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <Building2 className="w-3 h-3 text-gray-500" />
                        Studio
                    </p>
                    <div className="flex-1 border-b border-white/5 border-dotted mt-1" />
                    <p className="text-white font-semibold text-sm text-right">{anime.studio.name}</p>
                </div>
            )}
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
    const containerRef = useRef(null);

    const { data: anime, isLoading, isError } = useQuery({
        queryKey: ['anime', slug],
        queryFn: () => animeApi.getBySlug(slug).then(res => res.data),
        refetchOnMount: 'always',
    });

    const {
        data: reviewsData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: reviewsLoading
    } = useInfiniteQuery({
        queryKey: ['reviews', slug],
        queryFn: ({ pageParam = 1 }) => reviewApi.getAll({ anime: slug, page: pageParam }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch (e) { return undefined; }
            }
            return undefined;
        },
        enabled: !!slug
    });

    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    const reviewCount = reviewsData?.pages[0]?.count ?? anime?.review_count ?? reviews.length;

    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
            document.title = `${anime.title} - AniShows`;
        }
    }, [anime]);

    // Extract dominant color from cover image for dynamic theming
    useEffect(() => {
        if (!anime?.cover_image) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = anime.cover_image;

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 1;
                canvas.height = 1;
                ctx.drawImage(img, 0, 0, 1, 1);
                const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

                // Ensure the color is vibrant and usable
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                if (luminance > 0.05 && luminance < 0.9) {
                    const toHex = (c) => {
                        const hex = c.toString(16);
                        return hex.length === 1 ? '0' + hex : hex;
                    };
                    setAccentColor(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
                }
            } catch (e) {
                console.warn('Color extraction failed:', e);
            }
        };
    }, [anime?.cover_image]);

    const { data: related } = useQuery({
        queryKey: ['anime', slug, 'related'],
        queryFn: () => animeApi.getRelated(slug).then(res => res.data),
        enabled: !!anime,
    });

    const createReviewMutation = useMutation({
        mutationFn: (data) => reviewApi.create({ ...data, anime_slug: slug }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
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
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites', user.username] });
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
        }
    };

    const handleListUpdate = () => {
        queryClient.invalidateQueries({ queryKey: ['anime', slug] });
    };

    const handleReviewSubmit = async (data) => {
        if (editingReview) {
            await updateReviewMutation.mutateAsync({ id: editingReview.id, data });
        } else {
            await createReviewMutation.mutateAsync(data);
        }
    };

    const userReview = reviews.find(r => r.user?.username === user?.username);
    const canReview = isAuthenticated && anime?.user_list_status != null;

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
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

    const bannerUrl = getImageUrl(anime.banner_image) || getImageUrl(anime.cover_image) || `https://placehold.co/1920x600/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const coverUrl = getImageUrl(anime.cover_image) || `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;

    return (
        <div
            ref={containerRef}
            className="min-h-screen"
            style={accentColor ? { '--anime-accent': accentColor } : {}}
        >
            {/* Banner */}
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden">
                <img
                    src={bannerUrl}
                    alt={anime.title}
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent" />
            </div>

            {/* Content Container */}
            <div className="relative -mt-32 px-4 sm:px-6 lg:px-8 pb-16">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-8">

                        {/* Column 1: Poster & Mobile Info */}
                        <div className="flex flex-col gap-6">
                            <div className="flex-shrink-0 mx-auto lg:mx-0">
                                <img
                                    src={coverUrl}
                                    alt={anime.title}
                                    className="w-48 md:w-64 lg:w-full rounded-2xl shadow-2xl border border-gray-800"
                                />
                            </div>

                            <InformationBox anime={anime} accentColor={accentColor} className="hidden lg:flex" />
                        </div>

                        {/* Column 2: Main Content */}
                        <div className="flex-1 min-w-0">
                            <div className="text-center lg:text-left mb-8">
                                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 lg:items-end lg:gap-4 mb-2">
                                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-none">
                                        {anime.title}
                                    </h1>
                                    {anime.rating && (
                                        <div className="flex items-center gap-1.5 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-lg lg:mb-1.5">
                                            <Star className="w-4 h-4 text-yellow-500 fill-current" />
                                            <span className="text-lg font-black text-yellow-500">{anime.rating}</span>
                                        </div>
                                    )}
                                    {anime.site_rank && (
                                        <div
                                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg lg:mb-1.5"
                                            style={{
                                                backgroundColor: accentColor ? `${accentColor}15` : 'rgb(139 92 246 / 0.1)',
                                                borderWidth: '1px',
                                                borderColor: accentColor ? `${accentColor}30` : 'rgb(139 92 246 / 0.2)'
                                            }}
                                        >
                                            <Trophy className="w-4 h-4" style={{ color: accentColor || '#8b5cf6' }} />
                                            <span className="text-sm font-bold" style={{ color: accentColor || '#8b5cf6' }}>#{anime.site_rank} All Time</span>
                                        </div>
                                    )}
                                    {anime.popularity_rank && (
                                        <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg lg:mb-1.5">
                                            <TrendingUp className="w-4 h-4 text-blue-500" />
                                            <span className="text-sm font-bold text-blue-500">#{anime.popularity_rank} Popular</span>
                                        </div>
                                    )}
                                </div>
                                {anime.title_jp && (
                                    <p className="text-gray-400 text-lg mb-6 font-medium tracking-wide">{anime.title_jp}</p>
                                )}

                                <div className="flex flex-wrap justify-center lg:justify-start gap-2 mb-8">
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
                                <div className="flex flex-col lg:flex-row lg:items-center gap-6 bg-dark-100/40 p-6 rounded-3xl border border-gray-800/50 shadow-2xl backdrop-blur-md relative z-20">
                                    {isAuthenticated ? (
                                        <>
                                            {/* Primary Actions & Meta */}
                                            <div className="flex items-center gap-5 pr-6 lg:border-r border-gray-800/50">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={handleFavorite}
                                                        title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                                                        className={`p-3.5 rounded-2xl border transition-all duration-300 group
                                                            ${isFavorite
                                                                ? 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/20'
                                                                : 'bg-dark-200 border-gray-700 text-gray-400 hover:border-red-500/50 hover:text-red-500'}`}
                                                    >
                                                        <Heart className={`w-6 h-6 transition-transform group-hover:scale-110 ${isFavorite ? 'fill-current' : ''}`} />
                                                    </button>

                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(window.location.href);
                                                            alert('Link copied to clipboard!');
                                                        }}
                                                        title="Share Anime"
                                                        className="p-3.5 rounded-2xl border border-gray-700 bg-dark-200 text-gray-400 hover:border-accent/50 hover:text-accent transition-all duration-300 active:scale-95"
                                                    >
                                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                                        </svg>
                                                    </button>
                                                </div>

                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1">Watch Time</span>
                                                    <span className="text-base font-black text-white whitespace-nowrap">
                                                        {anime.episode_count ? (() => {
                                                            const duration = anime.duration_minutes || 24;
                                                            const totalMinutes = anime.episode_count * duration;
                                                            const hours = Math.floor(totalMinutes / 60);
                                                            const minutes = totalMinutes % 60;
                                                            return `${hours}h ${minutes}m`;
                                                        })() : 'N/A'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Status & Progress Selector */}
                                            <div className="flex-1">
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
                                            <Link to="/login" className="btn-primary w-full py-4 text-center rounded-2xl flex items-center justify-center gap-3">
                                                <Plus className="w-5 h-5" /> Sign In to Track Progress
                                            </Link>
                                        </div>
                                    )}
                                </div>
                                <InformationBox anime={anime} accentColor={accentColor} className="flex lg:hidden mt-8 mb-12" />
                            </div>

                            {/* Tab Navigation */}
                            <div className="flex items-center gap-2 mb-10 p-1.5 bg-dark-100/60 backdrop-blur-md rounded-2xl border border-white/5 w-fit">
                                {[
                                    { id: 'overview', label: 'Overview', icon: Film },
                                    { id: 'characters', label: 'Characters', icon: Users, count: anime.characters?.length },
                                    { id: 'staff', label: 'Staff', icon: Mic, count: anime.staff?.length },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300
                                            ${activeTab === tab.id
                                                ? 'text-white shadow-lg'
                                                : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                        style={activeTab === tab.id ? {
                                            backgroundColor: accentColor || '#8b5cf6',
                                            boxShadow: `0 10px 25px -5px ${accentColor || '#8b5cf6'}40`
                                        } : {}}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                        {tab.count > 0 && (
                                            <span className={`text-xs px-1.5 py-0.5 rounded-md ${activeTab === tab.id ? 'bg-white/20' : 'bg-white/5'}`}>
                                                {tab.count}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            {activeTab === 'overview' && (
                                <div key="overview" className="animate-tab-content">

                                    {/* Franchise Section (Sequels/Prequels) */}
                                    {anime.relations && anime.relations.length > 0 && (
                                        <div className="mb-12">
                                            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                                <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                                                Franchise
                                            </h2>
                                            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory">
                                                {anime.relations.map((rel) => (
                                                    <div key={rel.id} className="relative group flex-shrink-0 w-32 snap-start">
                                                        <div className="aspect-[2/3] rounded-xl overflow-hidden mb-2 border border-gray-800 bg-dark-200">
                                                            {rel.cover ? (
                                                                <img src={rel.cover} alt={rel.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-gray-700 bg-dark-300">
                                                                    <Film className="w-8 h-8" />
                                                                </div>
                                                            )}
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end">
                                                                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accentColor || '#8b5cf6' }}>{rel.type.replace('_', ' ')}</span>
                                                            </div>
                                                        </div>
                                                        <h4 className="text-sm font-bold text-gray-200 line-clamp-2 leading-tight mb-1 group-hover:text-white transition-colors">{rel.title}</h4>
                                                        <p className="text-xs text-gray-500">{rel.format} • {rel.status}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Synopsis Section with Read More */}
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
                                </div>
                            )}

                            {/* Characters Tab Content */}
                            {activeTab === 'characters' && anime.characters && anime.characters.length > 0 && (
                                <div key="characters" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-tab-content">
                                    {anime.characters.map((role) => (
                                        <div
                                            key={role.id}
                                            className="group relative h-64 overflow-hidden rounded-2xl border border-white/5 bg-dark-200/40 backdrop-blur-sm transition-all duration-500 hover:shadow-2xl"
                                            style={{
                                                '--card-accent': accentColor || '#8b5cf6'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = accentColor ? `${accentColor}50` : 'rgba(139,92,246,0.3)';
                                                e.currentTarget.style.boxShadow = `0 25px 50px -12px ${accentColor || '#8b5cf6'}15`;
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = '';
                                                e.currentTarget.style.boxShadow = '';
                                            }}
                                        >
                                            <div className="absolute inset-0">
                                                <img
                                                    src={role.character.image || '/placeholder-avatar.png'}
                                                    alt={role.character.name}
                                                    className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110 opacity-60 group-hover:opacity-40"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/80 to-transparent" />
                                                <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/40 to-transparent" />
                                            </div>
                                            <div className="relative h-full flex flex-col justify-end p-4 z-10">
                                                <div className="absolute top-3 right-3">
                                                    <span
                                                        className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-lg border backdrop-blur-md transition-colors duration-300
                                                            ${role.role === 'MAIN'
                                                                ? ''
                                                                : 'bg-white/5 border-white/10 text-gray-400 group-hover:border-white/20 group-hover:text-gray-300'}`}
                                                        style={role.role === 'MAIN' ? {
                                                            backgroundColor: accentColor ? `${accentColor}30` : 'rgba(139,92,246,0.2)',
                                                            borderColor: accentColor ? `${accentColor}50` : 'rgba(139,92,246,0.3)',
                                                            color: accentColor || '#8b5cf6'
                                                        } : {}}
                                                    >
                                                        {role.role}
                                                    </span>
                                                </div>
                                                <div className="transform transition-transform duration-300 group-hover:-translate-y-2">
                                                    <h3
                                                        className="text-xl font-black text-white leading-tight mb-1 transition-colors"
                                                        style={{ '--hover-color': accentColor || '#8b5cf6' }}
                                                    >
                                                        {role.character.name}
                                                    </h3>
                                                    {role.voice_actor && (
                                                        <div
                                                            className="flex items-center gap-2.5 mt-3 pt-3 border-t border-white/10 transition-colors"
                                                            style={{ '--accent-border': accentColor ? `${accentColor}30` : 'rgba(139,92,246,0.2)' }}
                                                        >
                                                            <div
                                                                className="w-8 h-8 rounded-full overflow-hidden border border-white/10 lg:w-9 lg:h-9 shrink-0 transition-colors"
                                                            >
                                                                <img
                                                                    src={role.voice_actor.image || '/placeholder-avatar.png'}
                                                                    alt={role.voice_actor.name}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-sm font-bold text-gray-300 group-hover:text-white transition-colors leading-tight whitespace-normal">
                                                                    {role.voice_actor.name}
                                                                </p>
                                                                <p
                                                                    className="text-[10px] font-bold text-gray-600 uppercase tracking-widest transition-colors mt-0.5"
                                                                    style={{ '--accent-text': accentColor ? `${accentColor}b3` : 'rgba(139,92,246,0.7)' }}
                                                                >
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
                            )}

                            {/* Staff Tab Content */}
                            {activeTab === 'staff' && anime.staff && anime.staff.length > 0 && (
                                <div key="staff" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-tab-content">
                                    {anime.staff.map((staffRole) => (
                                        <div key={staffRole.id} className="flex flex-col items-center text-center p-6 bg-dark-100/30 rounded-xl border border-gray-800/50 hover:bg-dark-100/50 transition-colors">
                                            <div className="w-20 h-20 rounded-full overflow-hidden border border-gray-700 mb-4 shadow-lg">
                                                <img src={staffRole.staff.image || '/placeholder-avatar.png'} alt={staffRole.staff.name} className="w-full h-full object-cover" />
                                            </div>
                                            <h4 className="font-bold text-white text-sm line-clamp-2 mb-1">{staffRole.staff.name}</h4>
                                            <p className="text-xs text-gray-500 line-clamp-1">{staffRole.role}</p>
                                        </div>
                                    ))}
                                </div>
                            )}


                            {/* Overview continues: Trailer and Reviews */}
                            {activeTab === 'overview' && (
                                <>
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
                                                        src={`https://www.youtube.com/embed/${videoId}`}
                                                        title="Trailer"
                                                        frameBorder="0"
                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                        allowFullScreen
                                                        className="absolute inset-0 w-full h-full"
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <div className="mb-16">
                                        <div className="flex items-center justify-between mb-8">
                                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                                <MessageSquare className="w-6 h-6" style={{ color: accentColor || '#8b5cf6' }} />
                                                Reviews
                                                <span className="text-sm font-normal text-gray-400 bg-dark-50 px-3 py-1 rounded-full border border-gray-800">
                                                    {reviewCount}
                                                </span>
                                            </h2>
                                            {isAuthenticated && !isWritingReview && !editingReview && !userReview && (
                                                canReview ? (
                                                    <button
                                                        onClick={() => setIsWritingReview(true)}
                                                        className="text-sm px-6 py-2.5 rounded-xl shadow-lg text-white font-bold"
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

                                        <div className="space-y-6">
                                            {reviewsLoading ? (
                                                <div className="text-center py-12">
                                                    <Loader className="w-10 h-10 text-accent animate-spin mx-auto" />
                                                </div>
                                            ) : reviews.length > 0 ? (
                                                <>
                                                    {reviews.map((review) => (
                                                        <ReviewCard
                                                            key={review.id}
                                                            review={review}
                                                            onEdit={setEditingReview}
                                                            onDelete={deleteReviewMutation.mutate}
                                                        />
                                                    ))}
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
                                                        {isAuthenticated && canReview && (
                                                            <button
                                                                onClick={() => setIsWritingReview(true)}
                                                                className="px-6 py-2.5 rounded-xl font-bold text-white transition-all shadow-lg"
                                                                style={{
                                                                    backgroundColor: accentColor || '#8b5cf6',
                                                                    boxShadow: `0 10px 25px -5px ${accentColor || '#8b5cf6'}40`
                                                                }}
                                                            >
                                                                Be the first to write a review →
                                                            </button>
                                                        )}
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Column 3: Sidebar */}
                        <div className="space-y-8 lg:pt-40">
                            {related && related.length > 0 && (
                                <div>
                                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                        <div className="w-1 h-6 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                                        Recommendations
                                    </h2>
                                    <div className="grid grid-cols-1 gap-4">
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
                                                <div className="flex-1 py-1">
                                                    <h3
                                                        className="text-gray-200 font-bold text-sm line-clamp-2 transition-colors leading-tight mb-1 group-hover:text-white"
                                                    >
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
                                    {related.length > 5 && (
                                        <Link
                                            to={`/browse?genre=${anime.genres?.[0]?.slug || ''}`}
                                            className="block text-center mt-6 text-xs font-bold hover:text-white transition-colors py-2 rounded-lg border"
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
        </div >
    );
}
