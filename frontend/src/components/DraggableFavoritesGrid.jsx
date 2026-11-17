import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { favoriteApi } from '../api/client';
import { getCommunityErrorMessage } from '../api/queries/social';
import logger from '../utils/logger';
import AnimeCard from './AnimeCard';

const GRID_CLASSES = 'grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 md:gap-4';
const CONTROL_CLASSES = 'bg-black/80 backdrop-blur-sm rounded p-1.5 border border-white/10 text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

const titleOf = (fav) => fav?.anime?.title || fav?.anime?.title_en || 'favorite';

const moveItem = (list, from, to) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

/**
 * The profile's favorites grid (standard AnimeCards).
 *
 * In `reorderMode` (owner only) it holds the user's full favorites list and
 * every card gets a handle (arrow keys move it) plus Move earlier / Move later
 * buttons; HTML5 drag works too on desktop. Each move saves the whole id
 * list (`favoriteApi.reorder(ids)`), one request at a time; a failed save
 * reverts to the last saved order and shows the server's message inline.
 */
export default function DraggableFavoritesGrid({
    favorites,
    isOwnProfile,
    reorderMode = false,
    onDone,
}) {
    const canReorder = Boolean(isOwnProfile && reorderMode);
    const [items, setItems] = useState(favorites || []);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
    const [errorMessage, setErrorMessage] = useState('');
    const [announcement, setAnnouncement] = useState('');
    const [focusTarget, setFocusTarget] = useState(null); // { id, control }

    const savedItemsRef = useRef(favorites || []);
    const inFlightRef = useRef(false);
    const queuedRef = useRef(null);
    const mountedRef = useRef(true);
    const controlRefs = useRef(new Map());

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Sync items when favorites prop changes (not while a save is pending)
    useEffect(() => {
        if (inFlightRef.current) return;
        setItems(favorites || []);
        savedItemsRef.current = favorites || [];
    }, [favorites]);

    // Keep keyboard focus on the moved card's control after the DOM reorders.
    useLayoutEffect(() => {
        if (!focusTarget) return;
        const refs = controlRefs.current;
        const preferred = refs.get(`${focusTarget.id}:${focusTarget.control}`);
        const node = preferred && !preferred.disabled ? preferred : refs.get(`${focusTarget.id}:handle`);
        node?.focus();
        setFocusTarget(null);
    }, [focusTarget, items]);

    const setControlRef = (id, control) => (node) => {
        const key = `${id}:${control}`;
        if (node) controlRefs.current.set(key, node);
        else controlRefs.current.delete(key);
    };

    const persist = useCallback(async (nextItems) => {
        if (inFlightRef.current) {
            queuedRef.current = nextItems;
            return;
        }
        inFlightRef.current = true;
        setSaveState('saving');
        setErrorMessage('');

        let pending = nextItems;
        let failed = false;
        while (pending) {
            try {
                await favoriteApi.reorder(pending.map((item) => item.id));
                savedItemsRef.current = pending;
                pending = queuedRef.current;
                queuedRef.current = null;
            } catch (error) {
                logger.error('Failed to save favorites order:', error);
                failed = true;
                queuedRef.current = null;
                pending = null;
                if (mountedRef.current) {
                    setItems(savedItemsRef.current);
                    setErrorMessage(getCommunityErrorMessage(error, 'Could not save the new order. Please try again.'));
                }
            }
        }
        inFlightRef.current = false;
        if (mountedRef.current) setSaveState(failed ? 'error' : 'saved');
    }, []);

    const applyMove = useCallback((from, to, control) => {
        if (!canReorder || from === to || to < 0 || to >= items.length) return;
        const next = moveItem(items, from, to);
        const moved = next[to];
        setItems(next);
        setAnnouncement(`Moved ${titleOf(moved)} to position ${to + 1} of ${next.length}.`);
        if (control) setFocusTarget({ id: moved.id, control });
        persist(next);
    }, [canReorder, items, persist]);

    const handleHandleKeyDown = (event, index) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            applyMove(index, index - 1, 'handle');
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            applyMove(index, index + 1, 'handle');
        } else if (event.key === 'Home') {
            event.preventDefault();
            applyMove(index, 0, 'handle');
        } else if (event.key === 'End') {
            event.preventDefault();
            applyMove(index, items.length - 1, 'handle');
        }
    };

    const handleDragStart = useCallback((e, index) => {
        if (!canReorder) return;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    }, [canReorder]);

    const handleDragEnd = useCallback(() => {
        if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
            applyMove(draggedIndex, dragOverIndex, null);
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
    }, [draggedIndex, dragOverIndex, applyMove]);

    const handleDragOver = useCallback((e, index) => {
        if (!canReorder) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (index !== dragOverIndex) {
            setDragOverIndex(index);
        }
    }, [canReorder, dragOverIndex]);

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

    const isSaving = saveState === 'saving';

    const renderCard = (fav, index) => {
        if (!fav?.anime) return null;
        const title = titleOf(fav);

        return (
            <div
                key={fav.id}
                draggable={canReorder}
                onDragStart={canReorder ? (e) => handleDragStart(e, index) : undefined}
                onDragEnd={canReorder ? handleDragEnd : undefined}
                onDragOver={canReorder ? (e) => handleDragOver(e, index) : undefined}
                onDragLeave={canReorder ? handleDragLeave : undefined}
                data-favorite-id={fav.id}
                className={`group relative transition-all duration-200 ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${draggedIndex === index ? 'opacity-50' : ''
                    } ${dragOverIndex === index ? 'scale-105 ring-2 ring-accent z-10' : ''}`}
            >
                {canReorder && (
                    <div className="absolute top-2 left-2 z-[260] flex items-center gap-1">
                        <button
                            type="button"
                            ref={setControlRef(fav.id, 'handle')}
                            onKeyDown={(e) => handleHandleKeyDown(e, index)}
                            className={`${CONTROL_CLASSES} cursor-grab`}
                            aria-label={`Reorder ${title}, position ${index + 1} of ${items.length}. Use arrow keys to move.`}
                        >
                            <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            ref={setControlRef(fav.id, 'earlier')}
                            onClick={() => applyMove(index, index - 1, 'earlier')}
                            disabled={index === 0}
                            className={CONTROL_CLASSES}
                            aria-label={`Move ${title} earlier`}
                            title="Move earlier"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            ref={setControlRef(fav.id, 'later')}
                            onClick={() => applyMove(index, index + 1, 'later')}
                            disabled={index === items.length - 1}
                            className={CONTROL_CLASSES}
                            aria-label={`Move ${title} later`}
                            title="Move later"
                        >
                            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                    </div>
                )}

                {/* While reordering the card itself is inert (no navigation, not in the tab order). */}
                <div inert={canReorder ? true : undefined}>
                    <AnimeCard
                        anime={fav.anime}
                        userListEntry={fav.anime?.user_list_status || undefined}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="relative">
            {canReorder && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-h-[1.25rem] text-xs text-gray-500" aria-live="polite">
                        {isSaving ? (
                            <span className="inline-flex items-center gap-2 text-gray-400">
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                                Saving order...
                            </span>
                        ) : saveState === 'saved' ? (
                            <span className="text-gray-400">Order saved.</span>
                        ) : (
                            <span>Use the arrows (or drag) to reorder. Changes save automatically.</span>
                        )}
                    </div>
                    {onDone && (
                        <button
                            type="button"
                            onClick={onDone}
                            disabled={isSaving}
                            className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
                        >
                            Done
                        </button>
                    )}
                </div>
            )}

            {canReorder && saveState === 'error' && errorMessage && (
                <div role="alert" className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                    {errorMessage}
                </div>
            )}

            <div className={GRID_CLASSES}>
                {items.map((fav, index) => renderCard(fav, index))}
            </div>

            {canReorder && (
                <p className="sr-only" aria-live="assertive">{announcement}</p>
            )}
        </div>
    );
}
