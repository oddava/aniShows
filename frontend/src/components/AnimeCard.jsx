import { Link } from 'react-router-dom';
import { Star, Heart, Plus, Check, Eye, Clock, Pause, X, Loader2 } from 'lucide-react';
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi } from '../api/client';
import { getOptimizedImageUrl, getImageSrcSet } from '../utils/imageUtils';
import logger from '../utils/logger';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', icon: Eye, color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/40' },
    { value: 'Plan to Watch', label: 'Plan to Watch', icon: Clock, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20 border-yellow-500/40' },
    { value: 'Completed', label: 'Completed', icon: Check, color: 'text-green-400', bgColor: 'bg-green-500/20 border-green-500/40' },
    { value: 'On Hold', label: 'On Hold', icon: Pause, color: 'text-orange-400', bgColor: 'bg-orange-500/20 border-orange-500/40' },
    { value: 'Dropped', label: 'Dropped', icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20 border-red-500/40' },
];

function AnimeCard({ anime, userListEntry, titleLanguage = 'en', lite = false, priority = false, index = 0 }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    // Simple state - no debounced hover
    const [isFavorite, setIsFavorite] = useState(anime.is_favorite || false);
    const [isLoading, setIsLoading] = useState(false);
    const [showStatusMenu, setShowStatusMenu] = useState(false);
    const [listStatus, setListStatus] = useState(userListEntry?.status || anime.user_list_status?.status || null);
    const [listId, setListId] = useState(userListEntry?.id || anime.user_list_status?.id || null);
    const [localEpisodesWatched, setLocalEpisodesWatched] = useState(
        userListEntry?.episodes_watched || anime.user_list_status?.episodes_watched || 0
    );

    const [imageLoaded, setImageLoaded] = useState(false);
    const statusMenuRef = useRef(null);

    // Memoized computed values - use optimized images with srcset
    const imageUrl = useMemo(() => getOptimizedImageUrl(anime, 'cover', 'medium'), [anime]);
    const imageSrcSet = useMemo(() => getImageSrcSet(anime, 'cover'), [anime]);
    const displayTitle = useMemo(() =>
        titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title,
        [titleLanguage, anime.title_jp, anime.title]
    );

    useEffect(() => {
        setImageLoaded(false);
    }, [imageUrl]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (statusMenuRef.current && !statusMenuRef.current.contains(event.target)) {
                setShowStatusMenu(false);
            }
        }
        if (showStatusMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showStatusMenu]);
    const currentStatusOption = useMemo(() =>
        STATUS_OPTIONS.find(s => s.value === listStatus),
        [listStatus]
    );

    const episodesWatched = localEpisodesWatched;

    // Determine loading strategy based on priority and index
    const loadingStrategy = useMemo(() => {
        if (priority || index < 6) {
            return { loading: 'eager', decoding: 'sync' };
        }
        return { loading: 'lazy', decoding: 'async' };
    }, [priority, index]);

    // Memoized handlers
    const handleFavorite = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || isLoading) return;

        const previousFavorite = isFavorite;
        setIsFavorite(!previousFavorite);
        setIsLoading(true);
        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
            queryClient.invalidateQueries({ queryKey: ['favorites'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error('Error toggling favorite:', error);
            setIsFavorite(previousFavorite);
        } finally {
            setIsLoading(false);
        }
    }, [anime.id, isAuthenticated, isLoading, isFavorite, queryClient]);

    const handleStatusChange = useCallback(async (e, newStatus) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || isLoading) return;

        const previousStatus = listStatus;
        const previousId = listId;

        setListStatus(newStatus);
        setShowStatusMenu(false);

        setIsLoading(true);
        try {
            if (listId) {
                await listApi.update(listId, { status: newStatus });
            } else {
                const response = await listApi.add({ anime_id: anime.id, status: newStatus });
                setListId(response.data.id);
            }
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error('Error updating list:', error);
            setListStatus(previousStatus);
            setListId(previousId);
        } finally {
            setIsLoading(false);
        }
    }, [anime.id, isAuthenticated, isLoading, listId, listStatus, queryClient]);

    const handleRemoveFromList = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!listId || isLoading) return;

        const previousStatus = listStatus;
        const previousId = listId;

        setListStatus(null);
        setListId(null);
        setShowStatusMenu(false);

        setIsLoading(true);
        try {
            await listApi.remove(previousId);
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error('Error removing from list:', error);
            setListStatus(previousStatus);
            setListId(previousId);
        } finally {
            setIsLoading(false);
        }
    }, [listId, listStatus, isLoading, queryClient]);

    const handleQuickProgress = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLoading) return;

        const previousEpisodes = localEpisodesWatched;
        const newEpisodes = previousEpisodes + 1;
        setLocalEpisodesWatched(newEpisodes);
        setIsLoading(true);

        try {
            const entryId = userListEntry?.id || listId;
            await listApi.update(entryId, { episodes_watched: newEpisodes });
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['anime'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error("Failed to update progress", error);
            setLocalEpisodesWatched(previousEpisodes);
        } finally {
            setIsLoading(false);
        }
    }, [localEpisodesWatched, userListEntry?.id, listId, isLoading, queryClient]);

    const toggleStatusMenu = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isLoading) setShowStatusMenu(prev => !prev);
    }, [isLoading]);

    if (lite) {
        return (
            <Link
                to={`/anime/${anime.slug}`}
                className="block aspect-[2/3] rounded-lg overflow-hidden relative group"
            >
                {!imageLoaded && (
                    <div className="absolute inset-0 skeleton-shimmer bg-dark-200 z-10 pointer-events-none" />
                )}
                <img
                    src={imageUrl}
                    srcSet={imageSrcSet}
                    sizes="(max-width: 767px) 160px, (max-width: 1023px) 33vw, 20vw"
                    alt={anime.title}
                    loading={loadingStrategy.loading}
                    decoding={loadingStrategy.decoding}
                    onLoad={() => setImageLoaded(true)}
                    className={`w-full h-full object-cover transition-transform duration-300 group-hover:bg-dark-50 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-2 left-2 right-2">
                        <h3 className="text-xs font-bold text-white line-clamp-2">{displayTitle}</h3>
                    </div>
                </div>
            </Link>
        );
    }

    return (
        <div className="group relative block h-full overflow-visible hover:z-[150]"
        >
            <div className="bg-dark-100 rounded-xl border border-gray-800 h-full flex flex-col relative transition-all duration-300 hover:border-accent/40">
                {/* Image Container */}
                <div className="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-dark-50 flex-shrink-0">
                    <Link to={`/anime/${anime.slug}`} className="block w-full h-full">
                        {!imageLoaded && (
                            <div className="absolute inset-0 skeleton-shimmer bg-dark-200 z-10 pointer-events-none" />
                        )}
                        <img
                            src={imageUrl}
                            srcSet={imageSrcSet}
                            sizes="(max-width: 767px) 160px, (max-width: 1023px) 33vw, 20vw"
                            alt={anime.title}
                            loading={loadingStrategy.loading}
                            decoding={loadingStrategy.decoding}
                            onLoad={() => setImageLoaded(true)}
                            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                        />
                    </Link>



                    {/* Status Icon */}
                    {isAuthenticated && (
                        <div className="absolute top-2 sm:top-3 left-2 sm:left-3 z-[200]">
                            <div className="relative" ref={statusMenuRef}>
                                <button
                                    onClick={toggleStatusMenu}
                                    disabled={isLoading}
                                    className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg sm:rounded-xl shadow-none border transition-all duration-200 touch-manipulation
                                        ${listStatus && currentStatusOption
                                            ? `${currentStatusOption.bgColor} ${currentStatusOption.color}`
                                            : 'bg-accent/90 text-white border-accent hover:bg-accent hover:border-accent-dark opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
                                    title={listStatus ? currentStatusOption?.label : 'Add to List'}
                                >
                                    {isLoading ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> :
                                        listStatus && currentStatusOption ? <currentStatusOption.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" /> : <Plus className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />}
                                </button>

                                {showStatusMenu && (
                                    <div className="absolute left-0 top-full mt-2 w-44 bg-dark-100 border border-gray-700 rounded-xl shadow-none z-[210] animate-fade-in overflow-hidden">
                                        <div className="p-1.5">
                                            {STATUS_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={(e) => handleStatusChange(e, option.value)}
                                                    className={`w-full px-3 py-2.5 flex items-center gap-3 text-xs font-semibold rounded-lg transition-colors touch-manipulation
                                                        ${listStatus === option.value ? 'bg-accent text-white' : `text-gray-300 hover:bg-white/10 ${option.color}`}`}
                                                >
                                                    <option.icon className="w-3.5 h-3.5" />
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                        {listStatus && (
                                            <div className="p-1.5 border-t border-gray-800 bg-black/20">
                                                <button onClick={handleRemoveFromList} className="w-full px-3 py-2.5 flex items-center gap-3 text-xs font-bold text-red-400 hover:bg-red-400/10 rounded-lg touch-manipulation">
                                                    <X className="w-3.5 h-3.5" /> Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {listStatus === 'Watching' && anime.episode_count && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60 z-20 overflow-hidden">
                            <div
                                style={{ width: `${Math.min((episodesWatched / anime.episode_count) * 100, 100)}%` }}
                                className={`h-full transition-all duration-700 ease-out ${episodesWatched >= anime.episode_count
                                    ? 'bg-green-500 '
                                    : 'bg-accent '}`}
                            />
                        </div>
                    )}
                    {/* Quick progress button */}
                    {isAuthenticated && listStatus === 'Watching' && (
                        <button
                            onClick={handleQuickProgress}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-accent text-white shadow-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer z-40 border-2 border-white/30 touch-manipulation"
                            title={`Mark episode ${episodesWatched + 1} as watched`}
                        >
                            {isLoading ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                                <Plus className="w-7 h-7 stroke-[3]" />
                            )}
                        </button>
                    )}
                </div>

                {/* Favorite Button */}
                {isAuthenticated && (
                    <div className={`absolute top-2 sm:top-3 right-2 sm:right-3 z-[100] transition-opacity duration-200 ${isFavorite ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
                    >
                        <button
                            onClick={handleFavorite}
                            className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg sm:rounded-xl shadow-none border transition-all duration-200 hover:bg-dark-50 touch-manipulation
                                ${isFavorite ? 'bg-red-500 text-white border-red-400' : 'bg-accent/90 text-white border-accent hover:bg-red-500 hover:border-red-400'}`}
                        >
                            <Heart className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                    </div>
                )}

                {/* Title/Info Footer */}
                <Link to={`/anime/${anime.slug}`} className="p-2.5 flex-grow flex flex-col bg-dark-100 rounded-b-xl"
                >
                    <h3 className="font-semibold text-white text-sm line-clamp-2 mb-1 leading-snug group-hover:text-accent-light transition-colors"
                    >
                        {displayTitle}
                    </h3>
                    <div className="flex items-center justify-between text-[11px] text-gray-400"
                    >
                        <span className="font-medium text-accent-light"
                        >{anime.anime_type || 'TV'}</span>
                        <div className="flex items-center gap-1 text-gray-400"
                        >
                            {listStatus === 'Watching' ? (
                                <>
                                    <span className="text-accent-light font-bold">{episodesWatched}</span>
                                    <span className="text-gray-500">/</span>
                                    <span>{anime.episode_count || '?'}</span>
                                    <span className="text-[10px] text-gray-500 ml-0.5">eps</span>
                                </>
                            ) : (
                                <span>{anime.episode_count || '?'} eps</span>
                            )}
                        </div>
                    </div>
                </Link>
            </div>
        </div>
    );
}

// Optimized prop comparison - shallow comparison is sufficient
const arePropsEqual = (prevProps, nextProps) => {
    if (prevProps.anime.id !== nextProps.anime.id) return false;
    if (prevProps.titleLanguage !== nextProps.titleLanguage) return false;
    if (prevProps.lite !== nextProps.lite) return false;
    if (prevProps.priority !== nextProps.priority) return false;
    if (prevProps.index !== nextProps.index) return false;
    if (prevProps.anime.is_favorite !== nextProps.anime.is_favorite) return false;

    const prevEntry = prevProps.userListEntry || prevProps.anime.user_list_status;
    const nextEntry = nextProps.userListEntry || nextProps.anime.user_list_status;
    if (!!prevEntry !== !!nextEntry) return false;
    if (prevEntry?.status !== nextEntry?.status) return false;
    if (prevEntry?.episodes_watched !== nextEntry?.episodes_watched) return false;
    return true;
};

export default React.memo(AnimeCard, arePropsEqual);

// Skeleton loader with AniList-style shimmer effect
export function AnimeCardSkeleton() {
    return (
        <div className="relative overflow-hidden rounded-lg bg-dark-100">
            {/* Shimmer overlay */}
            <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute inset-0 shimmer-overlay" />
            </div>

            {/* Card image placeholder */}
            <div className="aspect-[2/3] bg-dark-200 relative overflow-hidden">
                <div className="absolute inset-0 skeleton-shimmer" />
            </div>

            {/* Card content placeholder */}
            <div className="p-2.5 space-y-2">
                {/* Title line */}
                <div className="h-3.5 bg-dark-200 rounded relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-shimmer" />
                </div>
                {/* Subtitle line */}
                <div className="h-2.5 bg-dark-200 rounded w-2/3 relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-shimmer" />
                </div>
                {/* Rating line */}
                <div className="flex items-center gap-1.5 pt-0.5">
                    <div className="w-3 h-3 bg-dark-200 rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-shimmer" />
                    </div>
                    <div className="h-2.5 w-8 bg-dark-200 rounded relative overflow-hidden">
                        <div className="absolute inset-0 skeleton-shimmer" />
                    </div>
                </div>
            </div>
        </div>
    );
}
