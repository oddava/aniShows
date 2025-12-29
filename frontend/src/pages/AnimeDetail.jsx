import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Star, Heart, Play, Calendar, Clock, Tv, Plus, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import { animeApi, favoriteApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import StatusSelector from '../components/StatusSelector';

export default function AnimeDetail() {
    const { slug } = useParams();
    const { isAuthenticated } = useAuth();
    const [isFavorite, setIsFavorite] = useState(false);

    const { data: anime, isLoading, isError } = useQuery({
        queryKey: ['anime', slug],
        queryFn: () => animeApi.getBySlug(slug).then(res => res.data),
    });

    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
        }
    }, [anime]);

    const { data: related } = useQuery({
        queryKey: ['anime', slug, 'related'],
        queryFn: () => animeApi.getRelated(slug).then(res => res.data),
        enabled: !!anime,
    });

    const handleFavorite = async () => {
        if (!isAuthenticated) return;

        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
        } catch (error) {
            console.error('Error toggling favorite:', error);
        }
    };

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

    // Helper to handle image URLs and use proxy
    const getImageUrl = (url) => {
        if (!url) return null;

        // Strip backend hostnames to use relative paths (which go through proxy)
        let cleanUrl = url;
        if (cleanUrl.includes('localhost:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/localhost:8000/, '');
        }
        if (cleanUrl.includes('web:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/web:8000/, '');
        }

        if (cleanUrl.startsWith('http')) return cleanUrl;

        // Ensure relative paths start with /
        if (!cleanUrl.startsWith('/')) {
            cleanUrl = `/${cleanUrl}`;
        }

        return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
    };

    const bannerUrl = getImageUrl(anime.banner_image) || getImageUrl(anime.cover_image) || `https://placehold.co/1920x600/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const coverUrl = getImageUrl(anime.cover_image) || `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;

    return (
        <div className="min-h-screen">
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

            {/* Content */}
            <div className="relative -mt-32 px-4 pb-16">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row gap-8">
                        {/* Cover Image */}
                        <div className="flex-shrink-0 mx-auto md:mx-0">
                            <img
                                src={coverUrl}
                                alt={anime.title}
                                className="w-48 md:w-64 rounded-2xl shadow-2xl border border-gray-800"
                            />
                        </div>

                        {/* Info */}
                        <div className="flex-1 text-center md:text-left">
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
                                {anime.title}
                            </h1>
                            {anime.title_jp && (
                                <p className="text-gray-400 mb-4">{anime.title_jp}</p>
                            )}

                            {/* Stats */}
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-6">
                                {anime.rating && (
                                    <div className="flex items-center gap-1.5 text-yellow-400">
                                        <Star className="w-5 h-5 fill-current" />
                                        <span className="font-semibold text-lg">{anime.rating}</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5 text-gray-400">
                                    <Tv className="w-4 h-4" />
                                    <span>{anime.anime_type}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-gray-400">
                                    <Clock className="w-4 h-4" />
                                    <span>{anime.episode_count} episodes</span>
                                </div>
                                {anime.release_date && (
                                    <div className="flex items-center gap-1.5 text-gray-400">
                                        <Calendar className="w-4 h-4" />
                                        <span>{new Date(anime.release_date).getFullYear()}</span>
                                    </div>
                                )}
                            </div>

                            {/* Genres */}
                            <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-6">
                                {anime.genres?.map((genre) => (
                                    <Link
                                        key={genre.id}
                                        to={`/browse?genre=${genre.slug}`}
                                        className="badge hover:bg-accent hover:text-white transition-colors"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-8">
                                {isAuthenticated && (
                                    <>
                                        <button
                                            onClick={handleFavorite}
                                            className={`btn-secondary flex items-center gap-2 ${isFavorite ? 'bg-red-500/20 border-red-500 text-red-400' : ''}`}
                                        >
                                            <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
                                            {isFavorite ? 'Favorited' : 'Add to Favorites'}
                                        </button>
                                        <StatusSelector
                                            animeId={anime.id}
                                            initialStatus={anime.user_list_status}
                                        />
                                    </>
                                )}
                            </div>

                            {/* Synopsis */}
                            <div className="mb-8">
                                <h2 className="text-xl font-semibold text-white mb-3">Synopsis</h2>
                                <p className="text-gray-400 leading-relaxed">{anime.synopsis}</p>
                            </div>

                            {/* Trailer Player */}
                            {anime.trailer_url && (() => {
                                const getYouTubeId = (url) => {
                                    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
                                    return match ? match[1] : null;
                                };
                                const videoId = getYouTubeId(anime.trailer_url);
                                if (!videoId) return null;
                                return (
                                    <div className="mb-8">
                                        <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
                                            <Play className="w-5 h-5 text-accent" /> Trailer
                                        </h2>
                                        <div className="relative rounded-xl overflow-hidden border border-gray-800 aspect-video max-w-2xl">
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

                            {/* Studio */}
                            {anime.studio && (
                                <div className="mb-8">
                                    <h2 className="text-xl font-semibold text-white mb-3">Studio</h2>
                                    <p className="text-gray-400">{anime.studio.name}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Related Anime */}
                    {related && related.length > 0 && (
                        <div className="mt-16">
                            <h2 className="text-2xl font-bold text-white mb-6">Related Anime</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-6">
                                {related.slice(0, 6).map((anime) => (
                                    <AnimeCard key={anime.id} anime={anime} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
