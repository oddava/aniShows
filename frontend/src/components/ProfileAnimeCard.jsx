import { Link } from 'react-router-dom';
import { Star, Plus, Loader2 } from 'lucide-react';
import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { listApi } from '../api/client';
import { getImageUrl } from '../utils/imageUtils';
import logger from '../utils/logger';

/**
 * ProfileAnimeCard - Lightweight card for profile anime lists
 * Includes quick progress update for Watching tab
 */
function ProfileAnimeCard({ anime, episodesWatched = 0, showProgress = false, listEntryId, onProgressUpdate }) {
    const [isUpdating, setIsUpdating] = useState(false);
    const queryClient = useQueryClient();

    const handleQuickProgress = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isUpdating || !listEntryId) return;

        setIsUpdating(true);
        try {
            await listApi.update(listEntryId, { episodes_watched: episodesWatched + 1 });
            // Invalidate queries to refresh the list
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            if (onProgressUpdate) onProgressUpdate();
        } catch (error) {
            logger.error('Failed to update progress:', error);
        } finally {
            setIsUpdating(false);
        }
    }, [listEntryId, episodesWatched, isUpdating, queryClient, onProgressUpdate]);

    if (!anime) return null;

    const progress = anime.episode_count ? (episodesWatched / anime.episode_count) * 100 : 0;

    return (
        <div className="group relative bg-dark-100 rounded-xl border border-gray-800/60 overflow-hidden hover:border-accent/50 transition-all duration-300 card-hover-glow">
            <Link to={`/anime/${anime.slug}`} className="block cursor-default">
                {/* Image */}
                <div className="relative aspect-[2/3] bg-dark-50 overflow-hidden">
                    <img
                        src={getImageUrl(anime.cover_image, anime.title)}
                        alt={anime.title}
                        className="w-full h-full object-cover transition-transform duration-500"
                        loading="lazy"
                    />

                    {/* Gradient Overlay */}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60" />

                    {/* Rating badge */}
                    {anime.rating && (
                        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] border border-white/10">
                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-white font-bold">{anime.rating}</span>
                        </div>
                    )}

                    {/* Premium Progress bar on image */}
                    {showProgress && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/40 backdrop-blur-sm overflow-hidden">
                            <div
                                className={`h-full transition-all duration-700 ease-out ${progress >= 100 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-accent shadow-[0_0_8px_rgba(139,92,246,0.6)]'
                                    }`}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>
                    )}
                </div>

                {/* Title and Info */}
                <div className="p-2.5">
                    <h3 className="text-xs font-semibold text-white line-clamp-2 leading-tight group-hover:text-accent transition-colors">
                        {anime.title}
                    </h3>
                    <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                            {anime.anime_type || 'TV'}
                        </span>
                        {showProgress ? (
                            <span className="text-xs font-bold text-white flex items-center gap-1">
                                <span className="text-accent">{episodesWatched}</span>
                                <span className="text-gray-500">/</span>
                                <span>{anime.episode_count || '?'}</span>
                                <span className="text-[10px] text-gray-500 ml-0.5">eps</span>
                            </span>
                        ) : (
                            <span className="text-[10px] text-gray-500">
                                {anime.episode_count || '?'} eps
                            </span>
                        )}
                    </div>
                </div>
            </Link>

            {/* Quick progress button - Refined Design */}
            {showProgress && listEntryId && (
                <button
                    onClick={handleQuickProgress}
                    disabled={isUpdating}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-accent/90 text-white shadow-xl shadow-accent/40 opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100 hover:bg-accent hover:scale-110 cursor-pointer z-20 border-2 border-white/20 backdrop-blur-sm"
                    title={`Mark episode ${episodesWatched + 1} as watched`}
                >
                    {isUpdating ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Plus className="w-6 h-6 stroke-[3]" />
                    )}
                </button>
            )}
        </div>
    );
}

// Custom comparison for memo
const arePropsEqual = (prevProps, nextProps) => {
    return prevProps.anime?.id === nextProps.anime?.id
        && prevProps.episodesWatched === nextProps.episodesWatched
        && prevProps.showProgress === nextProps.showProgress
        && prevProps.listEntryId === nextProps.listEntryId;
};

export default React.memo(ProfileAnimeCard, arePropsEqual);

// Skeleton for loading state - matches compact favorites grid
export function ProfileAnimeCardSkeleton() {
    return (
        <div className="bg-dark-100 rounded-lg border border-gray-800 overflow-hidden">
            <div className="aspect-[2/3] bg-dark-50 animate-pulse" />
            <div className="p-2 space-y-1.5">
                <div className="h-3 bg-dark-50 rounded animate-pulse" />
                <div className="h-2 bg-dark-50 rounded w-2/3 animate-pulse" />
            </div>
        </div>
    );
}
