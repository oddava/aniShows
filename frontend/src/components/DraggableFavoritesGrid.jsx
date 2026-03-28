import React, { useState, useCallback } from 'react';
import { GripVertical, Star, Tv, Clock, Eye, CheckCircle, PauseCircle, XCircle, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { favoriteApi } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import logger from '../utils/logger';
import AnimeMediaImage from './common/AnimeMediaImage';

/**
 * DraggableFavoritesGrid - Unified grid layout with consistent card sizing
 * All cards use the same compact layout
 * Uses HTML5 drag-and-drop API for reordering
 */
export default function DraggableFavoritesGrid({ favorites, isOwnProfile, username }) {
    const [items, setItems] = useState(favorites);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const queryClient = useQueryClient();

    // Sync items when favorites prop changes
    React.useEffect(() => {
        setItems(favorites);
    }, [favorites]);

    const handleDragStart = useCallback((e, index) => {
        if (!isOwnProfile) return;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => {
            e.target.classList.add('opacity-50');
        }, 0);
    }, [isOwnProfile]);

    const handleDragEnd = useCallback(async (e) => {
        e.target.classList.remove('opacity-50');

        if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
            const newItems = [...items];
            const [draggedItem] = newItems.splice(draggedIndex, 1);
            newItems.splice(dragOverIndex, 0, draggedItem);

            setItems(newItems);

            if (isOwnProfile) {
                setIsSaving(true);
                try {
                    const orderedIds = newItems.map((item, idx) => ({ id: item.id, order: idx }));
                    await favoriteApi.reorder(orderedIds);
                    queryClient.invalidateQueries({ queryKey: ['favorites', username] });
                } catch (error) {
                    logger.error('Failed to save order:', error);
                    setItems(favorites);
                } finally {
                    setIsSaving(false);
                }
            }
        }

        setDraggedIndex(null);
        setDragOverIndex(null);
    }, [draggedIndex, dragOverIndex, items, favorites, isOwnProfile, username, queryClient]);

    const handleDragOver = useCallback((e, index) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (index !== dragOverIndex) {
            setDragOverIndex(index);
        }
    }, [dragOverIndex]);

    const handleDragLeave = useCallback(() => {
        setDragOverIndex(null);
    }, []);

    // Helper to get status icon and color
    const getStatusDisplay = (status) => {
        switch (status) {
            case 'Watching':
                return { icon: Eye, color: 'text-accent', label: 'Watching' };
            case 'Completed':
                return { icon: CheckCircle, color: 'text-emerald-400', label: 'Completed' };
            case 'On Hold':
                return { icon: PauseCircle, color: 'text-yellow-400', label: 'On Hold' };
            case 'Dropped':
                return { icon: XCircle, color: 'text-red-400', label: 'Dropped' };
            case 'Plan to Watch':
                return { icon: FileText, color: 'text-blue-400', label: 'Planning' };
            default:
                return { icon: Eye, color: 'text-gray-400', label: status || 'Not in list' };
        }
    };

    if (!items || items.length === 0) {
        return (
            <p className="text-center text-gray-400 py-12">
                No favorites yet. Start adding some!
            </p>
        );
    }

    // Render a card component - identical for all positions
    const renderCard = (fav, index) => {
        const isFeatured = index === 0;
        const listStatus = fav.anime?.user_list_status;
        const status = getStatusDisplay(listStatus?.status);
        const userScore = listStatus?.score || 0;
        const episodesWatched = listStatus?.episodes_watched || 0;

        return (
            <div
                key={fav.id}
                draggable={isOwnProfile}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                className={`group relative transition-all duration-200 ${isOwnProfile ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${dragOverIndex === index ? 'scale-105 ring-2 ring-accent z-10' : ''}`}
            >
                {/* Drag Handle */}
                {isOwnProfile && (
                    <div className="absolute top-1.5 left-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/80 backdrop-blur-sm rounded p-1 cursor-grab border border-white/10">
                            <GripVertical className="w-3 h-3 text-white" />
                        </div>
                    </div>
                )}



                {/* Card Content - Same structure for all cards */}
                <Link
                    to={`/anime/${fav.anime?.slug}`}
                    className="block bg-dark-100 rounded-lg border border-gray-800 overflow-hidden transition-all duration-300"
                    onClick={(e) => {
                        if (draggedIndex !== null) {
                            e.preventDefault();
                        }
                    }}
                >
                    <div className="relative aspect-[2/3] bg-dark-50 overflow-hidden">
                        <AnimeMediaImage
                            anime={fav.anime}
                            kind="cover"
                            size="small"
                            alt={fav.anime?.title}
                            className="w-full h-full object-cover transition-transform duration-500"
                            loading="lazy"
                            draggable={false}
                        />

                        {/* Rating Badge */}
                        {fav.anime?.rating && (
                            <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[10px] border border-white/10 transition-opacity duration-300">
                                <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400" />
                                <span className="text-white font-bold">{fav.anime.rating}</span>
                            </div>
                        )}
                    </div>

                    {/* Card Info */}
                    <div className="p-2">
                        <h3 className={`font-medium text-white line-clamp-2 leading-tight transition-colors ${isFeatured ? 'text-xs font-bold' : 'text-xs'
                            }`}>
                            {fav.anime?.title}
                        </h3>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-1">
                            <span className="flex items-center gap-0.5">
                                <Tv className="w-2.5 h-2.5" />
                                {fav.anime?.anime_type || 'TV'}
                            </span>
                            <span className="w-0.5 h-0.5 rounded-full bg-gray-600" />
                            <span>{fav.anime?.episode_count || '?'} eps</span>
                        </div>
                    </div>
                </Link>
            </div>
        );
    };

    return (
        <div className="relative">
            {isSaving && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50 rounded-2xl backdrop-blur-sm">
                    <div className="bg-dark-100 px-6 py-3 rounded-xl text-white text-sm font-medium flex items-center gap-2 shadow-xl">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving order...
                    </div>
                </div>
            )}

            {/* Unified Grid Layout - Responsive columns */}
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 md:gap-4">
                {items.map((fav, index) => renderCard(fav, index))}
            </div>

            {isOwnProfile && items.length > 1 && (
                <p className="text-center text-xs text-gray-500 mt-4">
                    Drag and drop to reorder your favorites
                </p>
            )}
        </div>
    );
}
