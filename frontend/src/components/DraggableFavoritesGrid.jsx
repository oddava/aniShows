import React, { useState, useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { favoriteApi } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';

/**
 * DraggableFavoritesGrid - Allows users to drag and drop favorites to reorder them
 * Uses HTML5 drag-and-drop API for simplicity and performance
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
        // Add a slight delay to allow the drag image to show correctly
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

            // Save the new order to the backend
            if (isOwnProfile) {
                setIsSaving(true);
                try {
                    const orderedIds = newItems.map((item, idx) => ({ id: item.id, order: idx }));
                    await favoriteApi.reorder(orderedIds);
                    queryClient.invalidateQueries({ queryKey: ['favorites', username] });
                } catch (error) {
                    console.error('Failed to save order:', error);
                    // Revert on error
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

    return (
        <div className="relative">
            {isSaving && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-50 rounded-lg">
                    <div className="bg-dark-100 px-4 py-2 rounded-lg text-white text-sm">
                        Saving order...
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                {items.map((fav, index) => (
                    <div
                        key={fav.id}
                        draggable={isOwnProfile}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        className={`group relative transition-all duration-200 ${isOwnProfile ? 'cursor-grab active:cursor-grabbing' : ''
                            } ${dragOverIndex === index ? 'scale-105 ring-2 ring-accent' : ''}`}
                    >
                        {/* Drag Handle - visible on hover for own profile */}
                        {isOwnProfile && (
                            <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="bg-black/80 rounded p-1 cursor-grab">
                                    <GripVertical className="w-4 h-4 text-white" />
                                </div>
                            </div>
                        )}

                        {/* Card Content */}
                        <Link
                            to={`/anime/${fav.anime?.slug}`}
                            className="block bg-dark-100 rounded-xl border border-gray-800 overflow-hidden hover:border-accent/40 transition-colors cursor-default"
                            onClick={(e) => {
                                // Prevent navigation during drag
                                if (draggedIndex !== null) {
                                    e.preventDefault();
                                }
                            }}
                        >
                            <div className="relative aspect-[2/3] bg-dark-50">
                                <img
                                    src={fav.anime?.cover_image}
                                    alt={fav.anime?.title}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    draggable={false}
                                />

                                {/* Rating */}
                                {fav.anime?.rating && (
                                    <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 rounded text-xs">
                                        <span className="text-yellow-400">★</span>
                                        <span className="text-white font-medium">{fav.anime.rating}</span>
                                    </div>
                                )}
                            </div>

                            <div className="p-2">
                                <h3 className="text-xs font-medium text-white line-clamp-2 leading-tight group-hover:text-accent transition-colors">
                                    {fav.anime?.title}
                                </h3>
                                <div className="text-[10px] text-gray-500 mt-1">
                                    {fav.anime?.anime_type || 'TV'} • {fav.anime?.episode_count || '?'} eps
                                </div>
                            </div>
                        </Link>
                    </div>
                ))}
            </div>

            {isOwnProfile && items.length > 1 && (
                <p className="text-center text-xs text-gray-500 mt-4">
                    Drag and drop to reorder your favorites
                </p>
            )}
        </div>
    );
}
