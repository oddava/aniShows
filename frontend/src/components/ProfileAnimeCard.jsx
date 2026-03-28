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
        <div className="flex flex-col h-full">
            <Link to={`/anime/${anime.slug}`} className="flex flex-col h-full">
                {/* Image Container */}
                <div className="relative aspect-[2/3] bg-dark-50 rounded-lg overflow-hidden">
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
                <div className="mt-3 block">
                    <h3 className="text-[12px] sm:text-[13px] font-medium text-gray-400 line-clamp-2 leading-[1.3] transition-colors hover:text-accent">
                        {anime.title}
                    </h3>
                    <div className="flex items-center justify-between mt-0.5 opacity-60">
                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                            {anime.anime_type || 'TV'}
                        </span>
                        {showProgress ? (
                            <span className="text-[9px] text-gray-400 font-bold">
                                {episodesWatched}/{anime.episode_count || '?'}
                            </span>
                        ) : (
                            <span className="text-[9px] text-gray-400 font-bold">
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
        <div className="flex flex-col h-full">
            <div className="aspect-[2/3] bg-dark-200 rounded-lg overflow-hidden" />
            <div className="mt-3 block space-y-2">
                <div className="h-2.5 bg-dark-200 rounded w-full" />
                <div className="h-2.5 bg-dark-200 rounded w-[85%]" />
            </div>
        </div>
    );
}
