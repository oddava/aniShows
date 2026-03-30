import React, { useState, useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import { favoriteApi } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import logger from '../utils/logger';
import AnimeCard from './AnimeCard';

/**
 * DraggableFavoritesGrid - Unified grid layout with consistent card sizing
 * All cards use the standard AnimeCard component
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
        e.dataTransfer.setData('text/plain', String(index));
    }, [isOwnProfile]);

    const handleDragEnd = useCallback(async () => {
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

    if (!items || items.length === 0) {
        return (
            <p className="text-center text-gray-400 py-12">
                No favorites yet. Start adding some!
            </p>
        );
    }

    const renderCard = (fav, index) => {
        if (!fav?.anime) return null;

        return (
            <div
                key={fav.id}
                draggable={isOwnProfile}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                className={`group relative transition-all duration-200 ${isOwnProfile ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${draggedIndex === index ? 'opacity-50' : ''
                    } ${dragOverIndex === index ? 'scale-105 ring-2 ring-accent z-10' : ''}`}
            >
                {isOwnProfile && (
                    <div className="absolute top-2 left-2 z-[260] opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/80 backdrop-blur-sm rounded p-1 cursor-grab border border-white/10">
                            <GripVertical className="w-3 h-3 text-white" />
                        </div>
                    </div>
                )}

                <AnimeCard
                    anime={fav.anime}
                    userListEntry={fav.anime?.user_list_status || undefined}
                />
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
