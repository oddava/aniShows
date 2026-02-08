import { Link } from 'react-router-dom';
import { Star, Heart, Plus, Check, Eye, Clock, Pause, X, Loader2 } from 'lucide-react';
import React, { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi } from '../api/client';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', icon: Eye, color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/40' },
    { value: 'Plan to Watch', label: 'Plan to Watch', icon: Clock, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20 border-yellow-500/40' },
    { value: 'Completed', label: 'Completed', icon: Check, color: 'text-green-400', bgColor: 'bg-green-500/20 border-green-500/40' },
    { value: 'On Hold', label: 'On Hold', icon: Pause, color: 'text-orange-400', bgColor: 'bg-orange-500/20 border-orange-500/40' },
    { value: 'Dropped', label: 'Dropped', icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20 border-red-500/40' },
];

// Memoized helper - runs once per URL
const getImageUrl = (url, title) => {
    if (!url) return `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(title || 'Anime')}`;
    let cleanUrl = url;
    if (cleanUrl.includes('localhost:8000')) cleanUrl = cleanUrl.replace(/^https?:\/\/localhost:8000/, '');
    if (cleanUrl.includes('web:8000')) cleanUrl = cleanUrl.replace(/^https?:\/\/web:8000/, '');
    if (cleanUrl.startsWith('http')) return cleanUrl;
    if (!cleanUrl.startsWith('/')) cleanUrl = `/${cleanUrl}`;
    return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
};

function AnimeCard({ anime, userListEntry, rank, titleLanguage = 'en', showProgress = false, lite = false }) {
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

    // Memoized computed values
    const imageUrl = useMemo(() => getImageUrl(anime.cover_image, anime.title), [anime.cover_image, anime.title]);
    const displayTitle = useMemo(() => 
        titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title,
        [titleLanguage, anime.title_jp, anime.title]
    );
    const currentStatusOption = useMemo(() => 
        STATUS_OPTIONS.find(s => s.value === listStatus),
        [listStatus]
    );

    const episodesWatched = localEpisodesWatched;

    // Memoized handlers
    const handleFavorite = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || isLoading) return;

        setIsLoading(true);
        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
        } catch (error) {
            console.error('Error toggling favorite:', error);
        } finally {
            setIsLoading(false);
        }
    }, [anime.id, isAuthenticated, isLoading]);

    const handleStatusChange = useCallback(async (e, newStatus) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || isLoading) return;

        setIsLoading(true);
        try {
            if (listId) {
                await listApi.update(listId, { status: newStatus });
            } else {
                const response = await listApi.add({ anime_id: anime.id, status: newStatus });
                setListId(response.data.id);
            }
            setListStatus(newStatus);
            setShowStatusMenu(false);
        } catch (error) {
            console.error('Error updating list:', error);
        } finally {
            setIsLoading(false);
        }
    }, [anime.id, isAuthenticated, isLoading, listId]);

    const handleRemoveFromList = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!listId || isLoading) return;

        setIsLoading(true);
        try {
            await listApi.remove(listId);
            setListStatus(null);
            setListId(null);
            setShowStatusMenu(false);
        } catch (error) {
            console.error('Error removing from list:', error);
        } finally {
            setIsLoading(false);
        }
    }, [listId, isLoading]);

    const handleQuickProgress = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLoading) return;

        const newEpisodes = episodesWatched + 1;
        setLocalEpisodesWatched(newEpisodes);
        setIsLoading(true);

        try {
            const entryId = userListEntry?.id || listId;
            await listApi.update(entryId, { episodes_watched: newEpisodes });
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['anime'] });
        } catch (error) {
            console.error("Failed to update progress", error);
            setLocalEpisodesWatched(episodesWatched);
        } finally {
            setIsLoading(false);
        }
    }, [episodesWatched, userListEntry?.id, listId, isLoading, queryClient]);

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
                <img
                    src={imageUrl}
                    alt={anime.title}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-2 left-2 right-2">
                        <h3 className="text-xs font-bold text-white line-clamp-2">{displayTitle}</h3>
                    </div>
                </div>
            </Link>
        );
    }

    return (
        <div className="group relative block h-full select-none overflow-visible hover:z-[150]"
        >
            <div className="bg-dark-100 rounded-xl border border-gray-800 h-full flex flex-col relative transition-all duration-300 hover:border-accent/40 card-hover-glow">
                {/* Image Container */}
                <div className="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-dark-50 flex-shrink-0">
                    <Link to={`/anime/${anime.slug}`} className="block w-full h-full">
                        <img
                            src={imageUrl}
                            alt={anime.title}
                            loading="lazy"
                            className="w-full h-full object-cover"
                        />
                    </Link>

                    {/* Rank Badge */}
                    {rank && (
                        <div className="absolute bottom-0 right-0 z-20 pointer-events-none">
                            <div className="px-3 py-1.5 rounded-tl-xl bg-black/60 border-t border-l border-white/10">
                                <span className={`font-black text-lg ${rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'text-white/80'}`}>
                                    #{rank}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Status Icon */}
                    {isAuthenticated && (
                        <div className="absolute top-2 sm:top-3 left-2 sm:left-3 z-[100]">
                            <div className="relative">
                                <button
                                    onClick={toggleStatusMenu}
                                    disabled={isLoading}
                                    className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg sm:rounded-xl shadow-lg border transition-all duration-200 touch-manipulation
                                        ${listStatus && currentStatusOption
                                            ? `${currentStatusOption.bgColor} ${currentStatusOption.color}`
                                            : 'bg-black/70 text-white border-white/30 hover:bg-accent hover:border-accent opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
                                    title={listStatus ? currentStatusOption?.label : 'Add to List'}
                                >
                                    {isLoading ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> :
                                        listStatus && currentStatusOption ? <currentStatusOption.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" /> : <Plus className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />}
                                </button>

                                {showStatusMenu && (
                                    <div className="absolute left-0 top-full mt-2 w-44 bg-dark-100 border border-gray-700 rounded-xl shadow-2xl z-[110] animate-fade-in overflow-hidden">
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
                                    ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                                    : 'bg-accent shadow-[0_0_8px_rgba(139,92,246,0.6)]'}`}
                            />
                        </div>
                    )}

                    {/* Rating badge */}
                    {anime.rating && (
                        <div className="absolute left-2 bottom-3 flex items-center gap-1.5 px-2 py-1 bg-black/70 rounded-lg text-xs z-10 border border-white/10">
                            <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                            <span className="text-white font-bold tracking-wide">{anime.rating}</span>
                        </div>
                    )}

                    {/* Quick progress button */}
                    {isAuthenticated && listStatus === 'Watching' && (
                            <button
                            onClick={handleQuickProgress}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-accent text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer z-40 border-2 border-white/30 touch-manipulation"
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
                            className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg sm:rounded-xl shadow-lg border transition-all duration-200 hover:scale-110 touch-manipulation
                                ${isFavorite ? 'bg-red-500 text-white border-red-400' : 'bg-black/70 text-white border-white/30 hover:bg-red-500 hover:border-red-400'}`}
                        >
                            <Heart className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                    </div>
                )}

                {/* Title/Info Footer */}
                <Link to={`/anime/${anime.slug}`} className="p-2.5 flex-grow flex flex-col bg-dark-100 rounded-b-xl"
                >
                    <h3 className="font-semibold text-white text-sm line-clamp-2 mb-1 leading-snug group-hover:text-accent transition-colors"
                    >
                        {displayTitle}
                    </h3>
                    <div className="flex items-center justify-between text-[11px] text-gray-400"
                    >
                        <span className="font-medium text-accent"
                        >{anime.anime_type || 'TV'}</span>
                        <div className="flex items-center gap-1 text-gray-400"
                        >
                            {listStatus === 'Watching' ? (
                                <>
                                    <span className="text-accent font-bold">{episodesWatched}</span>
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
    if (prevProps.rank !== nextProps.rank) return false;
    if (prevProps.titleLanguage !== nextProps.titleLanguage) return false;
    if (prevProps.lite !== nextProps.lite) return false;
    if (prevProps.anime.is_favorite !== nextProps.anime.is_favorite) return false;
    
    const prevEntry = prevProps.userListEntry || prevProps.anime.user_list_status;
    const nextEntry = nextProps.userListEntry || nextProps.anime.user_list_status;
    if (!!prevEntry !== !!nextEntry) return false;
    if (prevEntry?.status !== nextEntry?.status) return false;
    if (prevEntry?.episodes_watched !== nextEntry?.episodes_watched) return false;
    return true;
};

export default React.memo(AnimeCard, arePropsEqual);

// Skeleton loader
export function AnimeCardSkeleton() {
    return (
        <div className="bg-dark-100 rounded-lg border border-gray-800 overflow-hidden"
        >
            <div className="aspect-[2/3] bg-dark-50 animate-pulse" />
            <div className="p-2 space-y-1.5"
            >
                <div className="h-3 bg-dark-50 rounded animate-pulse" />
                <div className="h-2 bg-dark-50 rounded w-2/3 animate-pulse" />
            </div>
        </div>
    );
}
