import { Link } from 'react-router-dom';
import { Star, Heart, Plus, Check, Eye, Clock, Pause, X, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

function AnimeCard({ anime, userListEntry, isOwnProfile = true, rank, titleLanguage = 'en', showProgress = false, disableEffects = false, lite = false }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    // Consolidated state
    const [state, setState] = useState({
        isFavorite: anime.is_favorite || false,
        isLoading: false,
        showStatusMenu: false,
        showTooltip: false,
        listStatus: userListEntry?.status || anime.user_list_status?.status || null,
        listId: userListEntry?.id || anime.user_list_status?.id || null,
        localEpisodesWatched: userListEntry?.episodes_watched || anime.user_list_status?.episodes_watched || 0,
    });

    const menuRef = useRef(null);
    const buttonRef = useRef(null);
    const cardRef = useRef(null);
    const hoverTimeoutRef = useRef(null);

    // Memoized computed values
    const imageUrl = useMemo(() => getImageUrl(anime.cover_image, anime.title), [anime.cover_image, anime.title]);
    const displayTitle = useMemo(() => titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title, [titleLanguage, anime.title_jp, anime.title]);
    const currentStatusOption = useMemo(() => STATUS_OPTIONS.find(s => s.value === state.listStatus), [state.listStatus]);
    const progress = userListEntry?.progress || anime.user_list_status?.progress || 0;
    // Use local state for immediate updates, fall back to props
    const episodesWatched = state.localEpisodesWatched;

    // Tooltip position - computed once per hover
    const [tooltipPosition, setTooltipPosition] = useState('right');

    // Sync list entry state (including episodes watched)
    useEffect(() => {
        const newStatus = userListEntry?.status || anime.user_list_status?.status || null;
        const newId = userListEntry?.id || anime.user_list_status?.id || null;
        const newEpisodes = userListEntry?.episodes_watched || anime.user_list_status?.episodes_watched || 0;
        if (newStatus !== state.listStatus || newId !== state.listId || newEpisodes !== state.localEpisodesWatched) {
            setState(s => ({ ...s, listStatus: newStatus, listId: newId, localEpisodesWatched: newEpisodes }));
        }
    }, [userListEntry?.status, userListEntry?.id, userListEntry?.episodes_watched, anime.user_list_status?.status, anime.user_list_status?.id, anime.user_list_status?.episodes_watched]);

    // Close menu when clicking outside
    useEffect(() => {
        if (!state.showStatusMenu) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target) &&
                buttonRef.current && !buttonRef.current.contains(e.target)) {
                setState(s => ({ ...s, showStatusMenu: false }));
            }
        };
        const timeoutId = setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [state.showStatusMenu]);

    // Memoized handlers - prevent recreation
    const handleFavorite = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || state.isLoading) return;

        setState(s => ({ ...s, isLoading: true }));
        try {
            const response = await favoriteApi.toggle(anime.id);
            setState(s => ({ ...s, isFavorite: response.data.is_favorite, isLoading: false }));
        } catch (error) {
            console.error('Error toggling favorite:', error);
            setState(s => ({ ...s, isLoading: false }));
        }
    }, [anime.id, isAuthenticated, state.isLoading]);

    const handleStatusChange = useCallback(async (e, newStatus) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || state.isLoading) return;

        setState(s => ({ ...s, isLoading: true }));
        try {
            if (state.listId) {
                await listApi.update(state.listId, { status: newStatus });
            } else {
                const response = await listApi.add({ anime_id: anime.id, status: newStatus });
                setState(s => ({ ...s, listId: response.data.id }));
            }
            setState(s => ({ ...s, listStatus: newStatus, showStatusMenu: false, isLoading: false }));
        } catch (error) {
            console.error('Error updating list:', error);
            setState(s => ({ ...s, isLoading: false }));
        }
    }, [anime.id, isAuthenticated, state.isLoading, state.listId]);

    const handleRemoveFromList = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.listId || state.isLoading) return;

        setState(s => ({ ...s, isLoading: true }));
        try {
            await listApi.remove(state.listId);
            setState(s => ({ ...s, listStatus: null, listId: null, showStatusMenu: false, isLoading: false }));
        } catch (error) {
            console.error('Error removing from list:', error);
            setState(s => ({ ...s, isLoading: false }));
        }
    }, [state.listId, state.isLoading]);

    const handleQuickProgress = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.isLoading) return;

        const newEpisodes = state.localEpisodesWatched + 1;
        // Optimistically update local state immediately
        setState(s => ({ ...s, isLoading: true, localEpisodesWatched: newEpisodes }));

        try {
            const entryId = userListEntry?.id || state.listId;
            await listApi.update(entryId, { episodes_watched: newEpisodes });
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['anime'] });
        } catch (error) {
            console.error("Failed to update progress", error);
            // Rollback on error
            setState(s => ({ ...s, localEpisodesWatched: s.localEpisodesWatched - 1 }));
        } finally {
            setState(s => ({ ...s, isLoading: false }));
        }
    }, [state.localEpisodesWatched, userListEntry?.id, state.listId, state.isLoading, queryClient]);

    // Debounced hover - reduces state changes
    const handleMouseEnter = useCallback(() => {
        if (lite) return; // No tooltip in lite mode
        hoverTimeoutRef.current = setTimeout(() => {
            if (cardRef.current) {
                const rect = cardRef.current.getBoundingClientRect();
                setTooltipPosition(rect.right + 280 > window.innerWidth ? 'left' : 'right');
            }
            setState(s => ({ ...s, showTooltip: true }));
        }, 200); // 200ms delay prevents flicker
    }, [lite]);

    const handleMouseLeave = useCallback(() => {
        clearTimeout(hoverTimeoutRef.current);
        setState(s => ({ ...s, showTooltip: false }));
    }, []);

    const toggleStatusMenu = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.isLoading) setState(s => ({ ...s, showStatusMenu: !s.showStatusMenu }));
    }, [state.isLoading]);

    // Skip render for main card if effects disabled during mount
    const isVisible = disableEffects ? true : state.showTooltip !== undefined;

    return (
        <div
            ref={cardRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={`group relative block h-full select-none opacity-100 overflow-visible hover:z-[150]`}
        >
            {/* Main Card */}
            {/* Main Card - no hover lifting/scaling */}
            <div className={`bg-dark-100 rounded-xl border border-gray-800 h-full flex flex-col relative
                ${lite ? '' : 'transition-colors duration-200 hover:border-accent/50'}`}>

                {/* Image Container */}
                <div className="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-dark-50 flex-shrink-0">
                    <Link to={`/anime/${anime.slug}`} className="block w-full h-full cursor-default">
                        <img
                            src={imageUrl}
                            alt={anime.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    </Link>

                    {/* Rank Badge */}
                    {rank && (
                        <div className="absolute bottom-0 right-0 z-20 pointer-events-none">
                            <div className="px-3 py-1.5 rounded-tl-xl bg-black/60 border-t border-l border-white/10">
                                <span className={`font-black text-base ${rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-500' : 'text-white/80'}`}>
                                    #{rank}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Status Icon - consolidated: visible when in list, appears on hover when not */}
                    {isAuthenticated && !lite && (
                        <div className="absolute top-2 left-2 z-[100]">
                            <div className="relative">
                                <button
                                    ref={buttonRef}
                                    onClick={toggleStatusMenu}
                                    disabled={state.isLoading}
                                    className={`w-7 h-7 flex items-center justify-center rounded-lg shadow border transition-all duration-200
                                        ${state.listStatus && currentStatusOption
                                            ? `${currentStatusOption.bgColor} ${currentStatusOption.color}`
                                            : 'bg-black/70 text-white border-white/20 hover:bg-accent opacity-0 group-hover:opacity-100'}`}
                                    title={state.listStatus ? currentStatusOption?.label : 'Add to List'}
                                >
                                    {state.isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                                        state.listStatus && currentStatusOption ? <currentStatusOption.icon className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                                </button>

                                {/* Dropdown */}
                                {state.showStatusMenu && (
                                    <div ref={menuRef} className="absolute left-0 top-full mt-1 w-36 bg-dark-100 border border-gray-700 rounded-lg shadow-xl z-[110]">
                                        <div className="p-1">
                                            {STATUS_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={(e) => handleStatusChange(e, option.value)}
                                                    className={`w-full px-2 py-1.5 flex items-center gap-2 text-xs rounded transition-colors
                                                        ${state.listStatus === option.value ? 'bg-accent text-white' : `text-gray-300 hover:bg-white/10 ${option.color}`}`}
                                                >
                                                    <option.icon className="w-3 h-3" />
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                        {state.listStatus && (
                                            <div className="p-1 border-t border-gray-800">
                                                <button onClick={handleRemoveFromList} className="w-full px-2 py-1 flex items-center gap-2 text-xs text-red-400 hover:bg-red-400/10 rounded">
                                                    <X className="w-3 h-3" /> Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Progress Bar - show for watching status */}
                    {state.listStatus === 'Watching' && anime.episode_count && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60 z-20">
                            <div
                                style={{ width: `${Math.min((episodesWatched / anime.episode_count) * 100, 100)}%` }}
                                className={`h-full ${episodesWatched >= anime.episode_count ? 'bg-green-500' : 'bg-purple-500'}`}
                            />
                        </div>
                    )}

                    {/* Rating badge */}
                    {anime.rating && (
                        <div className="absolute left-2 bottom-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 rounded text-xs z-10">
                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-white font-medium">{anime.rating}</span>
                        </div>
                    )}

                    {/* Quick progress button - hover only */}
                    {isAuthenticated && state.listStatus === 'Watching' && !lite && (
                        <button
                            onClick={handleQuickProgress}
                            className="absolute bottom-2 right-2 w-7 h-7 flex items-center justify-center rounded bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity z-30"
                            title="Mark next episode"
                        >
                            {state.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        </button>
                    )}
                </div>

                {/* Favorite Button - Hover Only, top-right */}
                {isAuthenticated && !lite && (
                    <div className="absolute top-2 right-2 z-[100] opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={handleFavorite}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg shadow border transition-colors
                                ${state.isFavorite ? 'bg-red-500 text-white border-red-500' : 'bg-black/70 text-white border-white/20 hover:bg-red-500'}`}
                        >
                            <Heart className={`w-3.5 h-3.5 ${state.isFavorite ? 'fill-current' : ''}`} />
                        </button>
                    </div>
                )}

                {/* Title/Info Footer */}
                <Link to={`/anime/${anime.slug}`} className="p-2.5 flex-grow flex flex-col bg-dark-100 rounded-b-xl cursor-default">
                    <h3 className="font-semibold text-white text-sm line-clamp-2 mb-1 leading-snug">
                        {displayTitle}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className="font-bold text-accent">{anime.anime_type || 'TV'}</span>
                        <span>•</span>
                        <span>{anime.episode_count ? (episodesWatched > 0 ? `${episodesWatched}/${anime.episode_count}` : anime.episode_count) : '?'} eps</span>
                    </div>
                    {/* Genres - only if not user list entry */}
                    {anime.genres?.length > 0 && !userListEntry  && (
                        <div className="flex flex-wrap gap-1 mt-auto pt-1.5">
                            {anime.genres.slice(0, 2).map((genre) => (
                                <span key={genre.id} className="px-1.5 py-0.5 bg-dark-50/80 text-[9px] text-gray-400 rounded border border-gray-700/50">
                                    {genre.name}
                                </span>
                            ))}
                        </div>
                    )}
                    

                </Link>
            </div>

            {/* Tooltip - Lazy rendered with delay */}
            {state.showTooltip && !lite && (
                <div className={`absolute top-4 w-60 z-[200] bg-dark-100/95 p-3 border border-gray-700 rounded-lg shadow-xl pointer-events-none
                    ${tooltipPosition === 'right' ? 'left-full ml-3' : 'right-full mr-3'}`}>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold text-accent">
                            {anime.release_date || anime.start_date ? new Date(anime.release_date || anime.start_date).getFullYear() : 'Unknown'}
                        </span>
                        {anime.status && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium
                                ${anime.status === 'Airing' ? 'bg-green-500/20 text-green-400' :
                                    anime.status === 'Upcoming' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-300'}`}>
                                {anime.status}
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-gray-300 line-clamp-3 leading-relaxed">
                        {anime.synopsis || "No synopsis available."}
                    </p>
                    {anime.studio_name && (
                        <div className="text-[10px] text-gray-500 mt-2">Studio: {anime.studio_name}</div>
                    )}
                </div>
            )}
        </div>
    );
}

// Optimized prop comparison
const arePropsEqual = (prevProps, nextProps) => {
    if (prevProps.anime.id !== nextProps.anime.id) return false;
    if (prevProps.rank !== nextProps.rank) return false;
    if (prevProps.titleLanguage !== nextProps.titleLanguage) return false;
    if (prevProps.lite !== nextProps.lite) return false;
    if (prevProps.anime.is_favorite !== nextProps.anime.is_favorite) return false;

    const prevEntry = prevProps.userListEntry || prevProps.anime.user_list_status;
    const nextEntry = nextProps.userListEntry || nextProps.anime.user_list_status;
    if (!!prevEntry !== !!nextEntry) return false;
    if (prevEntry && nextEntry) {
        if (prevEntry.status !== nextEntry.status) return false;
        if (prevEntry.episodes_watched !== nextEntry.episodes_watched) return false;
    }
    return true;
};

export default React.memo(AnimeCard, arePropsEqual);

// Skeleton loader
export function AnimeCardSkeleton() {
    return (
        <div className="bg-dark-100 rounded-xl border border-gray-800 h-full flex flex-col">
            <div className="aspect-[2/3] bg-dark-50 rounded-t-xl animate-pulse" />
            <div className="p-2.5 space-y-2">
                <div className="h-4 bg-dark-50 rounded animate-pulse" />
                <div className="h-3 bg-dark-50 rounded w-2/3 animate-pulse" />
            </div>
        </div>
    );
}
