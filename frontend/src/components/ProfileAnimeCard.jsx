import { Link } from 'react-router-dom';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getOptimizedImageUrl,
} from '../utils/imageUtils';

/**
 * ProfileAnimeCard - Ultra-lightweight card for profile anime lists
 */
export default function ProfileAnimeCard({ anime, episodesWatched = 0, showProgress = false }) {
    if (!anime) return null;

    const progress = anime.episode_count ? (episodesWatched / anime.episode_count) * 100 : 0;
    const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
    const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');

    return (
        <div className="bg-dark-100 rounded-lg border border-gray-800/60 overflow-hidden">
            <Link to={`/anime/${anime.slug}`} className="block">
                {/* Image Container */}
                <div className="relative aspect-[2/3] bg-dark-50">
                    <img
                        src={imageUrl}
                        alt={anime.title}
                        onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                    />

                    {/* Simple progress bar - no animations */}
                    {showProgress && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                            <div
                                className={`h-full ${progress >= 100 ? 'bg-green-500' : 'bg-accent'}`}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>
                    )}
                </div>

                {/* Title and Info */}
                <div className="p-2 h-[64px] flex flex-col justify-start">
                    <h3 className="text-xs font-medium text-white line-clamp-2 leading-tight mb-auto">
                        {anime.title}
                    </h3>
                    <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                            {anime.anime_type || 'TV'}
                        </span>
                        {showProgress ? (
                            <span className="text-[10px] text-gray-500 font-bold">
                                {episodesWatched}/{anime.episode_count || '?'}
                            </span>
                        ) : (
                            <span className="text-[10px] text-gray-500 font-bold">
                                {anime.episode_count || '?'} eps
                            </span>
                        )}
                    </div>
                </div>
            </Link>
        </div>
    );
}

// Skeleton for loading state - minimal
export function ProfileAnimeCardSkeleton() {
    return (
        <div className="bg-dark-100 rounded-lg border border-gray-800/60 overflow-hidden">
            <div className="aspect-[2/3] bg-dark-200" />
            <div className="p-2 h-[64px] space-y-1.5 flex flex-col justify-start">
                <div className="h-2.5 bg-dark-200 rounded w-full" />
                <div className="mt-auto flex justify-between">
                    <div className="h-2 bg-dark-200 rounded w-1/3" />
                    <div className="h-2 bg-dark-200 rounded w-1/4" />
                </div>
            </div>
        </div>
    );
}
