import { Link } from 'react-router-dom';
import { Star, Heart, Plus, Check, Eye, Clock, Pause, X, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { favoriteApi, listApi } from '../api/client';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', icon: Eye, color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/40' },
    { value: 'Plan to Watch', label: 'Plan to Watch', icon: Clock, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20 border-yellow-500/40' },
    { value: 'Completed', label: 'Completed', icon: Check, color: 'text-green-400', bgColor: 'bg-green-500/20 border-green-500/40' },
    { value: 'On Hold', label: 'On Hold', icon: Pause, color: 'text-orange-400', bgColor: 'bg-orange-500/20 border-orange-500/40' },
    { value: 'Dropped', label: 'Dropped', icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20 border-red-500/40' },
];

export default function AnimeCard({ anime, userListEntry, isOwnProfile = true, rank, titleLanguage = 'en' }) {
    const { isAuthenticated } = useAuth();
    const [isFavorite, setIsFavorite] = useState(anime.is_favorite || false);
    const [isLoading, setIsLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [showStatusMenu, setShowStatusMenu] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);
    const [listStatus, setListStatus] = useState(userListEntry?.status || anime.user_list_status?.status || null);
    const [listId, setListId] = useState(userListEntry?.id || anime.user_list_status?.id || null);
    const menuRef = useRef(null);
    const buttonRef = useRef(null);
    const hoverTimeoutRef = useRef(null);
    const cardRef = useRef(null);
    const [tooltipPosition, setTooltipPosition] = useState('right');

    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 50);
        return () => clearTimeout(timer);
    }, []);

    // Close menu when clicking outside
    useEffect(() => {
        if (!showStatusMenu) return;

        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target) &&
                buttonRef.current && !buttonRef.current.contains(event.target)) {
                setShowStatusMenu(false);
            }
        };

        // Use setTimeout to avoid the click that opened the menu from immediately closing it
        const timeoutId = setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [showStatusMenu]);

    useEffect(() => {
        if (userListEntry) {
            setListStatus(userListEntry.status);
            setListId(userListEntry.id);
        } else if (anime.user_list_status) {
            setListStatus(anime.user_list_status.status);
            setListId(anime.user_list_status.id);
        }
    }, [userListEntry, anime.user_list_status]);

    const handleFavorite = async (e) => {
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
    };

    const handleStatusChange = async (e, newStatus) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isAuthenticated || isLoading) {
            return;
        }

        setIsLoading(true);
        try {
            if (listId) {
                // Update existing entry
                await listApi.update(listId, { status: newStatus });
            } else {
                // Create new entry
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
    };

    const handleRemoveFromList = async (e) => {
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
    };

    const getImageUrl = (url) => {
        if (!url) return `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
        let cleanUrl = url;
        if (cleanUrl.includes('localhost:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/localhost:8000/, '');
        }
        if (cleanUrl.includes('web:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/web:8000/, '');
        }
        if (cleanUrl.startsWith('http')) return cleanUrl;
        if (!cleanUrl.startsWith('/')) {
            cleanUrl = `/${cleanUrl}`;
        }
        return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
    };

    const imageUrl = getImageUrl(anime.cover_image);
    const progress = userListEntry?.progress || anime.user_list_status?.progress || 0;
    const displayTitle = titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title;
    const currentStatusOption = STATUS_OPTIONS.find(s => s.value === listStatus);

    // Hover handlers with delay for tooltip
    const handleMouseEnter = () => {
        // Check if card is near the right edge of the viewport
        if (cardRef.current) {
            const rect = cardRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            // If the card is in the right 30% of the viewport, show tooltip on left
            if (rect.right > viewportWidth * 0.7) {
                setTooltipPosition('left');
            } else {
                setTooltipPosition('right');
            }
        }
        hoverTimeoutRef.current = setTimeout(() => {
            setShowTooltip(true);
        }, 100); // 100ms delay before showing tooltip - reduced for snappier feel
    };

    const handleMouseLeave = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
        setShowTooltip(false);
    };

    // Get status style for tooltip
    const getStatusStyle = (status) => {
        switch (status) {
            case 'Airing': return 'bg-green-500/20 text-green-400 border-green-500/40';
            case 'Finished': return 'bg-gray-500/20 text-gray-300 border-gray-500/40';
            case 'Upcoming': return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
            default: return 'bg-gray-800 text-gray-400';
        }
    };

    return (
        <div
            ref={cardRef}
            className={`group relative block h-full select-none ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'} transition-all duration-500 hover:z-50`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Main Card Area - with lift effect on hover */}
            <div className="bg-dark-100 rounded-xl border border-gray-800 transition-all duration-300 hover:border-accent/50 hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent/10 h-full flex flex-col relative">

                {/* Image Container - overflow-hidden ONLY here for image zoom */}
                <div className="relative aspect-[2/3] overflow-hidden rounded-t-xl bg-dark-50 flex-shrink-0">
                    <Link to={`/anime/${anime.slug}`} className="block w-full h-full">
                        <img
                            src={imageUrl}
                            alt={anime.title}
                            className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.02] group-hover:brightness-110"
                            loading="lazy"
                        />

                        {/* Hover Gradient Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-dark-100 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </Link>

                    {/* Ghosty Rank Badge */}
                    {rank && (
                        <div className="absolute bottom-0 right-0 z-20 pointer-events-none">
                            <div className="relative px-4 py-2 rounded-tl-2xl bg-black/40 backdrop-blur-md border-t border-l border-white/10 shadow-2xl">
                                <span className={`relative font-black text-lg tracking-tight
                                    ${rank === 1 ? 'text-yellow-400' :
                                        rank === 2 ? 'text-gray-300' :
                                            rank === 3 ? 'text-amber-500' :
                                                'text-white/80'}`}
                                >
                                    #{rank}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* List Status Badge */}
                    {listStatus && currentStatusOption && (
                        <div className={`absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1.5 backdrop-blur-md rounded-lg z-20 ${currentStatusOption.color} ${currentStatusOption.bgColor} border pointer-events-none shadow-lg animate-fade-in`}>
                            <currentStatusOption.icon className="w-3.5 h-3.5" />
                            <span className="text-[11px] font-bold uppercase tracking-wide">{currentStatusOption.label}</span>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {userListEntry && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700 z-10 pointer-events-none">
                            <div
                                style={{ width: `${progress}%` }}
                                className={`h-full ${progress >= 100 ? 'bg-green-500' : 'bg-accent'}`}
                            />
                        </div>
                    )}

                    {/* Rating badge */}
                    {anime.rating && (
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg z-10 pointer-events-none">
                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-xs font-bold text-white">{anime.rating}</span>
                        </div>
                    )}
                </div>

                {/* Action Buttons - with staggered animation */}
                <div className="absolute top-2 right-2 flex flex-col gap-2 z-[100]">
                    {isAuthenticated && (
                        <>
                            {/* Quick Add Button */}
                            <div className="relative">
                                <button
                                    ref={buttonRef}
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!isLoading) setShowStatusMenu(!showStatusMenu);
                                    }}
                                    disabled={isLoading}
                                    className={`w-10 h-10 flex items-center justify-center rounded-xl backdrop-blur-md shadow-lg border border-white/10 transition-all duration-300 hover:scale-110 active:scale-95 translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 focus:ring-2 focus:ring-accent focus:outline-none
                                        ${listStatus ? 'bg-accent text-white border-accent shadow-accent/30' : 'bg-black/50 text-white hover:bg-accent hover:border-accent'}`}
                                    title={listStatus ? 'Change status' : 'Add to Library'}
                                >
                                    {isLoading ? (
                                        <Loader2 className="w-5 h-5 animate-spin-custom" />
                                    ) : (
                                        listStatus ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />
                                    )}
                                </button>

                                {/* Status Dropdown */}
                                {showStatusMenu && (
                                    <div
                                        ref={menuRef}
                                        className="absolute right-0 top-full mt-2 w-48 bg-dark-100 border border-gray-700 rounded-xl shadow-2xl z-[110] ring-1 ring-black/5 animate-fade-in"
                                    >
                                        <div className="p-1.5 space-y-0.5">
                                            {STATUS_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={(e) => {
                                                        handleStatusChange(e, option.value);
                                                    }}
                                                    className={`w-full px-3 py-2.5 text-left flex items-center gap-3 text-sm rounded-lg transition-all duration-150 active:scale-95
                                                    ${listStatus === option.value
                                                            ? 'bg-accent text-white'
                                                            : `text-gray-300 hover:bg-white/10 ${option.color}`}`}
                                                >
                                                    <option.icon className="w-4 h-4" />
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                        {listStatus && (
                                            <div className="p-1.5 border-t border-gray-800">
                                                <button
                                                    type="button"
                                                    onClick={handleRemoveFromList}
                                                    className="w-full px-3 py-2 text-left flex items-center gap-3 text-sm text-red-400 hover:bg-red-400/10 rounded-lg transition-all active:scale-95"
                                                >
                                                    <X className="w-4 h-4" />
                                                    Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={handleFavorite}
                                disabled={isLoading}
                                className={`w-10 h-10 flex items-center justify-center rounded-xl backdrop-blur-md shadow-lg border border-white/10 transition-all duration-300 delay-75 hover:scale-110 active:scale-95 translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 focus:ring-2 focus:ring-red-400 focus:outline-none
                                    ${isFavorite ? 'bg-red-500 text-white border-red-500 shadow-red-500/30' : 'bg-black/50 text-white hover:bg-red-500 hover:border-red-500'}`}
                                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin-custom" />
                                ) : (
                                    <Heart className={`w-5 h-5 transition-transform ${isFavorite ? 'fill-current' : ''}`} />
                                )}
                            </button>
                        </>
                    )}
                </div>

                {/* Content */}
                <Link to={`/anime/${anime.slug}`} className="p-3 md:p-4 flex-grow flex flex-col relative z-20 bg-dark-100 rounded-b-xl">
                    <h3 className="font-bold text-white text-sm md:text-base line-clamp-2 mb-1.5 leading-snug group-hover:text-accent transition-colors group-hover:underline decoration-accent/50 underline-offset-2">
                        {displayTitle}
                    </h3>

                    <div className="flex items-center gap-2 text-xs text-gray-200 mb-2 font-medium">
                        <span className="text-gray-200">{anime.anime_type || 'TV'}</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-gray-200">{anime.episode_count ? `${anime.episode_count} eps` : '? eps'}</span>
                    </div>

                    {/* Genres */}
                    {anime.genres?.length > 0 && !userListEntry && (
                        <div className="flex flex-wrap gap-1 mt-auto pt-1">
                            {anime.genres.slice(0, 2).map((genre) => (
                                <object key={genre.id}>
                                    <Link
                                        to={`/browse?genre=${genre.slug}`}
                                        className="inline-block px-1.5 py-0.5 bg-dark-50/60 hover:bg-accent/20 hover:text-accent text-[9px] md:text-[10px] text-gray-400 rounded border border-gray-700/50 hover:border-accent/30 transition-colors"
                                    >
                                        {genre.name}
                                    </Link>
                                </object>
                            ))}
                        </div>
                    )}
                </Link>
            </div>

            {/* Hover Tooltip / Card - Desktop Only with delayed appearance */}
            {showTooltip && (
                <div className={`hidden md:block absolute top-0 w-64 bg-dark-100 rounded-xl shadow-2xl border border-gray-700 p-4 z-50 pointer-events-none animate-fade-in
                    ${tooltipPosition === 'right' ? 'left-full ml-3' : 'right-full mr-3'}`}
                >
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-accent">{anime.release_date || anime.start_date ? new Date(anime.release_date || anime.start_date).getFullYear() : 'Unknown'}</span>
                        {anime.status && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide font-medium border ${getStatusStyle(anime.status)}`}>
                                {anime.status}
                            </span>
                        )}
                    </div>
                    <h4 className="font-bold text-white text-sm mb-2 line-clamp-2">{anime.title}</h4>
                    <p className="text-xs text-gray-300 line-clamp-3 leading-relaxed">
                        {anime.synopsis || "No synopsis available."}
                    </p>
                    {(anime.studios || anime.studio || anime.studio_name) && (
                        <div className="mt-3 pt-2 border-t border-gray-800 text-[10px] text-gray-400 flex items-center gap-1">
                            <span className="text-gray-500">Studio:</span>
                            <span className="text-gray-300">{anime.studio_name || (anime.studio?.name) || (anime.studios?.map(s => s.name).join(', '))}</span>
                        </div>
                    )}
                    {/* CTA hint */}
                    <div className="mt-3 pt-2 border-t border-gray-800 flex items-center justify-between text-[10px]">
                        <span className="text-gray-500">Click to view details</span>
                        {!listStatus && isAuthenticated && (
                            <span className="text-accent font-medium">+ Add to Library</span>
                        )}
                    </div>
                </div>
            )}


        </div>
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
