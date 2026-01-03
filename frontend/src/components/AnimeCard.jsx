import { Link } from 'react-router-dom';
import { Star, Heart } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { favoriteApi } from '../api/client';

export default function AnimeCard({ anime, userListEntry }) {
    const { isAuthenticated } = useAuth();
    const [isFavorite, setIsFavorite] = useState(anime.is_favorite || false);
    const [isLoading, setIsLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 50);
        return () => clearTimeout(timer);
    }, []);

    const handleFavorite = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isAuthenticated) return;

        setIsLoading(true);
        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
        } catch (error) {
            console.error('Error toggling favorite:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to handle image URLs and use proxy
    const getImageUrl = (url) => {
        if (!url) return `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;

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

    const imageUrl = getImageUrl(anime.cover_image);
    const progress = userListEntry?.progress || 0;

    return (
        <Link to={`/anime/${anime.slug}`} className={`group block h-full transition-all duration-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="relative h-full flex flex-col bg-dark-100 rounded-xl overflow-hidden border border-gray-800/50 transition-all duration-300 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5">
                {/* Image Container */}
                <div className="relative aspect-[2/3] overflow-hidden bg-dark-50 flex-shrink-0">
                    <img
                        src={imageUrl}
                        alt={anime.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                    />

                    {/* Hover overlay - smooth fade */}
                    <div className="absolute inset-0 bg-gradient-to-t from-dark-100 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Progress Bar (if user list entry exists) */}
                    {userListEntry && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700 z-10">
                            <div
                                style={{ width: `${progress}%` }}
                                className={`h-full ${progress >= 100 ? 'bg-green-500' : 'bg-accent'}`}
                            />
                        </div>
                    )}

                    {/* Favorite button - slides in from right on hover */}
                    {isAuthenticated && (
                        <button
                            onClick={handleFavorite}
                            disabled={isLoading}
                            className={`absolute top-3 right-3 p-2.5 rounded-full backdrop-blur-md transition-all duration-300
                                ${isFavorite
                                    ? 'bg-red-500 text-white opacity-100 translate-x-0'
                                    : 'bg-black/60 text-white opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0'
                                } hover:scale-110 active:scale-95`}
                        >
                            <Heart className={`w-4 h-4 transition-transform ${isFavorite ? 'fill-current scale-110' : ''}`} />
                        </button>
                    )}

                    {/* Rating badge */}
                    {anime.rating && (
                        <div className="absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-lg mb-1">
                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-xs font-semibold text-white">{anime.rating}</span>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="p-4 flex-grow flex flex-col">
                    <h3 className="font-semibold text-white line-clamp-2 mb-2 transition-colors duration-200 group-hover:text-accent">
                        {anime.title}
                    </h3>

                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{anime.anime_type}</span>
                        <span>•</span>
                        <span>{anime.episode_count} eps</span>
                    </div>

                    {/* User Progress Text */}
                    {userListEntry && (
                        <div className="mt-2 text-xs text-accent font-medium">
                            {userListEntry.episodes_watched} / {anime.episode_count || '?'} eps
                        </div>
                    )}

                    {/* Genres */}
                    {anime.genres?.length > 0 && !userListEntry && (
                        <div className="flex flex-wrap gap-1 mt-auto pt-2">
                            {anime.genres.slice(0, 2).map((genre) => (
                                <span key={genre.id} className="badge text-xs">
                                    {genre.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}

// Skeleton loader
export function AnimeCardSkeleton() {
    return (
        <div className="card h-full flex flex-col">
            <div className="aspect-[2/3] skeleton flex-shrink-0" />
            <div className="p-4 space-y-3 flex-grow flex flex-col">
                <div className="h-4 skeleton rounded w-3/4" />
                <div className="h-3 skeleton rounded w-1/2" />
                <div className="flex gap-2 mt-auto">
                    <div className="h-5 skeleton rounded-full w-16" />
                    <div className="h-5 skeleton rounded-full w-12" />
                </div>
            </div>
        </div>
    );
}
