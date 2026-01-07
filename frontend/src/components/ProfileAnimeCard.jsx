import { Link } from 'react-router-dom';
import { Star, Plus, Loader2 } from 'lucide-react';
import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { listApi } from '../api/client';

/**
 * ProfileAnimeCard - Lightweight card for profile anime lists
 * Includes quick progress update for Watching tab
 */
function ProfileAnimeCard({ anime, episodesWatched = 0, showProgress = false, listEntryId, onProgressUpdate }) {
    if (!anime) return null;

    const [isUpdating, setIsUpdating] = useState(false);
    const queryClient = useQueryClient();
    const progress = anime.episode_count ? (episodesWatched / anime.episode_count) * 100 : 0;

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
            console.error('Failed to update progress:', error);
        } finally {
            setIsUpdating(false);
        }
    }, [listEntryId, episodesWatched, isUpdating, queryClient, onProgressUpdate]);

    return (
        <div className="group relative bg-dark-100 rounded-lg border border-gray-800 overflow-hidden hover:border-accent/40 transition-colors">
            <Link to={`/anime/${anime.slug}`} className="block cursor-default">
                {/* Image */}
                <div className="relative aspect-[2/3] bg-dark-50">
                    <img
                        src={anime.cover_image}
                        alt={anime.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />

                    {/* Rating badge */}
                    {anime.rating && (
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 rounded text-xs">
                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-white font-medium">{anime.rating}</span>
                        </div>
                    )}

                    {/* Progress bar */}
                    {showProgress && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                            <div
                                className={`h-full ${progress >= 100 ? 'bg-green-500' : 'bg-accent'}`}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>
                    )}
                </div>

                {/* Title */}
                <div className="p-2">
                    <h3 className="text-xs font-medium text-white line-clamp-2 leading-tight">
                        {anime.title}
                    </h3>
                    <div className="text-[10px] text-gray-500 mt-1">
                        {anime.anime_type || 'TV'} • {episodesWatched > 0 ? `${episodesWatched}/` : ''}{anime.episode_count || '?'} eps
                    </div>
                </div>
            </Link>

            {/* Quick progress button - only show in Watching mode with valid entry */}
            {showProgress && listEntryId && (
                <button
                    onClick={handleQuickProgress}
                    disabled={isUpdating}
                    className="absolute bottom-[52px] right-2 w-7 h-7 flex items-center justify-center rounded-lg bg-black/80 text-white border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-accent hover:border-accent z-10"
                    title={`Mark episode ${episodesWatched + 1} as watched`}
                >
                    {isUpdating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Plus className="w-4 h-4" />
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

// Skeleton for loading state
export function ProfileAnimeCardSkeleton() {
    return (
        <div className="bg-dark-100 rounded-lg border border-gray-800 overflow-hidden">
            <div className="aspect-[2/3] bg-dark-50 animate-pulse" />
            <div className="p-2 space-y-2">
                <div className="h-3 bg-dark-50 rounded animate-pulse" />
                <div className="h-2 bg-dark-50 rounded w-2/3 animate-pulse" />
            </div>
        </div>
    );
}
