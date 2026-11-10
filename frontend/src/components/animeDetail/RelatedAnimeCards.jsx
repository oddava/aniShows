import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import AnimeMediaImage from '../common/AnimeMediaImage';

// Memoized related anime card component
export const RelatedAnimeCard = memo(({ anime }) => {
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
                <h3 className="text-gray-200 font-bold text-sm line-clamp-2 transition-colors leading-tight mb-1 group-hover:text-white">
                    {anime.title}
                </h3>
                <div className="flex items-center gap-2 text-xs text-gray-400">
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
export const MobileRelatedCard = memo(({ anime }) => {
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
            <h3 className="text-gray-200 font-bold text-sm line-clamp-2 leading-tight mb-1 group-hover:text-white transition-colors">
                {anime.title}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
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
