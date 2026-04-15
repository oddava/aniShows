import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Bookmark,
    Check,
    ChevronDown,
    Eye,
    Minus,
    Pause,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import logger from '../utils/logger';
import ListEntryEditModal from './ListEntryEditModal';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', color: 'bg-green-500', icon: Eye },
    { value: 'Completed', label: 'Completed', color: 'bg-blue-500', icon: Check, hoverOnly: true },
    { value: 'On Hold', label: 'On Hold', color: 'bg-yellow-500', icon: Pause },
    { value: 'Dropped', label: 'Dropped', color: 'bg-red-500', icon: Trash2 },
    { value: 'Plan to Watch', label: 'Plan to Watch', color: 'bg-gray-500', icon: Bookmark },
];

const DEFAULT_MODAL_ENTRY = {
    status: 'Plan to Watch',
    score: 0,
    episodes_watched: 0,
    started_at: null,
    finished_at: null,
    total_rewatches: 0,
    notes: '',
};

function invalidateLocalListQueries(queryClient) {
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
}

export default function StatusSelector({
    animeId,
    initialStatus,
    onUpdate,
    totalEpisodes,
    isOwnProfile = true,
    compactSidebar = false,
    showEditInDropdown = true,
    externalEditTrigger = 0,
}) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const dropdownRef = useRef(null);
    const dragStartY = useRef(null);
    const lastHandledEditTrigger = useRef(externalEditTrigger);

    const [isOpen, setIsOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [dragOffset, setDragOffset] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const [entrySnapshot, setEntrySnapshot] = useState(initialStatus || null);
    const [currentStatus, setCurrentStatus] = useState(initialStatus?.status || null);
    const [episodesWatched, setEpisodesWatched] = useState(initialStatus?.episodes_watched || 0);
    const [localEpisodes, setLocalEpisodes] = useState(initialStatus?.episodes_watched || 0);
    const [listId, setListId] = useState(initialStatus?.id || null);

    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 640;

    const syncLocalEntry = useCallback((entry) => {
        if (!entry) {
            setEntrySnapshot(null);
            setCurrentStatus(null);
            setEpisodesWatched(0);
            setLocalEpisodes(0);
            setListId(null);
            return;
        }

        const nextEpisodes = entry.episodes_watched || 0;
        setEntrySnapshot(entry);
        setCurrentStatus(entry.status || null);
        setEpisodesWatched(nextEpisodes);
        setLocalEpisodes(nextEpisodes);
        setListId(entry.id || null);
    }, []);

    useEffect(() => {
        syncLocalEntry(initialStatus || null);
    }, [initialStatus, syncLocalEntry]);

    useEffect(() => {
        if (externalEditTrigger > lastHandledEditTrigger.current) {
            setIsEditModalOpen(true);
        }
        lastHandledEditTrigger.current = externalEditTrigger;
    }, [externalEditTrigger]);

    const closeDropdown = useCallback(() => {
        if (isMobileViewport) {
            setIsClosing(true);
            setTimeout(() => {
                setIsOpen(false);
                setIsClosing(false);
                setDragOffset(0);
            }, 300);
            return;
        }

        setIsOpen(false);
        setDragOffset(0);
    }, [isMobileViewport]);

    const closeDropdownImmediately = useCallback(() => {
        setIsOpen(false);
        setIsClosing(false);
        setDragOffset(0);
    }, []);

    const toggleDropdown = () => {
        if (isOpen) {
            closeDropdown();
            return;
        }

        setIsClosing(false);
        setDragOffset(0);
        setIsOpen(true);
    };

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                closeDropdown();
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeDropdown]);

    if (!isAuthenticated || !isOwnProfile) return null;

    const applyResponseEntry = (entry) => {
        syncLocalEntry(entry);
        invalidateLocalListQueries(queryClient);
        if (onUpdate) onUpdate(entry);
    };

    const getEntryId = () => listId || entrySnapshot?.id || initialStatus?.id || null;

    const getModalEntry = () => {
        if (!currentStatus && !listId) {
            return DEFAULT_MODAL_ENTRY;
        }

        return {
            ...DEFAULT_MODAL_ENTRY,
            ...(entrySnapshot || initialStatus || {}),
            id: getEntryId(),
            status: currentStatus || entrySnapshot?.status || initialStatus?.status || DEFAULT_MODAL_ENTRY.status,
            episodes_watched: episodesWatched,
        };
    };

    const handleStatusChange = async (newStatus) => {
        if (isLoading) return;

        const entryId = getEntryId();
        let nextEpisodes = episodesWatched;

        if (newStatus === 'Completed' && totalEpisodes && totalEpisodes > 0) {
            nextEpisodes = totalEpisodes;
        } else if (newStatus === 'Plan to Watch') {
            nextEpisodes = 0;
        }

        setIsLoading(true);

        try {
            const response = entryId
                ? await listApi.update(entryId, {
                    status: newStatus,
                    episodes_watched: nextEpisodes,
                })
                : await listApi.add({
                    anime_id: animeId,
                    status: newStatus,
                    episodes_watched: nextEpisodes,
                });

            applyResponseEntry(response.data);
            closeDropdown();
        } catch (error) {
            logger.error('Failed to update status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemove = async () => {
        const entryId = getEntryId();
        if (!entryId || isLoading) return;

        setIsLoading(true);

        try {
            await listApi.remove(entryId);
            syncLocalEntry(null);
            invalidateLocalListQueries(queryClient);
            if (onUpdate) onUpdate(null);
            closeDropdownImmediately();
        } catch (error) {
            logger.error('Failed to remove entry:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEpisodeChange = async (newEpisodes) => {
        const entryId = getEntryId();
        if (!entryId || isLoading) return;

        if (newEpisodes < 0 || (totalEpisodes && totalEpisodes > 0 && newEpisodes > totalEpisodes)) {
            setLocalEpisodes(episodesWatched);
            return;
        }

        const previousEpisodes = episodesWatched;
        const previousStatus = currentStatus;
        let nextStatus = currentStatus;

        if (totalEpisodes > 0 && newEpisodes === totalEpisodes) {
            nextStatus = 'Completed';
        } else if (currentStatus === 'Completed' && totalEpisodes > 0 && newEpisodes < totalEpisodes) {
            nextStatus = 'Watching';
        }

        setIsLoading(true);
        setEpisodesWatched(newEpisodes);
        setLocalEpisodes(newEpisodes);
        if (nextStatus !== currentStatus) {
            setCurrentStatus(nextStatus);
        }

        try {
            const payload = { episodes_watched: newEpisodes };
            if (nextStatus !== previousStatus) {
                payload.status = nextStatus;
            }

            const response = await listApi.update(entryId, payload);
            applyResponseEntry(response.data);
        } catch (error) {
            logger.error('Failed to update episodes:', error);
            setEpisodesWatched(previousEpisodes);
            setLocalEpisodes(previousEpisodes);
            setCurrentStatus(previousStatus);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenEditModal = () => {
        closeDropdownImmediately();
        setIsEditModalOpen(true);
    };

    const handleSaveDetailedEntry = async (payload) => {
        const entryId = getEntryId();
        setIsLoading(true);

        try {
            const response = entryId
                ? await listApi.update(entryId, payload)
                : await listApi.add({ anime_id: animeId, ...payload });

            applyResponseEntry(response.data);
            setIsEditModalOpen(false);
        } catch (error) {
            logger.error('Failed to save detailed list entry:', error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    const handleTouchStart = (event) => {
        if (!isMobileViewport) return;
        dragStartY.current = event.touches[0].clientY;
    };

    const handleTouchMove = (event) => {
        if (!isMobileViewport || dragStartY.current === null) return;
        const delta = event.touches[0].clientY - dragStartY.current;
        if (delta > 0) {
            setDragOffset(delta);
        }
    };

    const handleTouchEnd = () => {
        if (!isMobileViewport) return;
        if (dragOffset > 100) {
            closeDropdown();
        } else {
            setDragOffset(0);
        }
        dragStartY.current = null;
    };

    const currentOption = STATUS_OPTIONS.find((option) => option.value === currentStatus);
    const progressPercentage = totalEpisodes ? Math.round((episodesWatched / totalEpisodes) * 100) : 0;

    const renderDropdownMenu = () => {
        if (!isOpen) return null;

        return (
            <>
                <div
                    className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-[99] sm:hidden ${isClosing ? 'animate-out fade-out' : 'animate-fade-in'}`}
                    onClick={closeDropdown}
                />

                <div
                    className={isMobileViewport
                        ? `fixed bottom-0 left-0 right-0 z-[100] p-4 pb-10 bg-dark-100 rounded-t-[32px] border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] ${isClosing ? 'animate-out slide-out-to-bottom' : 'animate-in slide-in-from-bottom'}`
                        : `absolute top-full left-0 mt-3 p-2 bg-dark-100 rounded-2xl shadow-none z-[100] ${compactSidebar ? 'w-full min-w-[220px]' : 'w-56 border border-dark-50'}`}
                    style={isMobileViewport ? {
                        transform: `translateY(${dragOffset}px)`,
                        transition: dragStartY.current ? 'none' : 'transform 0.2s ease-out',
                    } : undefined}
                >
                    {isMobileViewport && (
                        <div
                            className="w-12 h-1.5 bg-gray-800/80 rounded-full mx-auto mb-6 cursor-grab active:cursor-grabbing"
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                        />
                    )}

                    {STATUS_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => handleStatusChange(option.value)}
                            className={`w-full px-4 py-3.5 sm:px-3 sm:py-2.5 text-left flex items-center gap-4 sm:gap-3 transition-all duration-200 group rounded-xl sm:rounded-lg ${currentStatus === option.value ? 'bg-white/10' : 'hover:bg-white/5'}`}
                        >
                            <div className={`${isMobileViewport ? 'w-10 h-10' : 'w-8 h-8'} shrink-0 flex items-center justify-center rounded-xl sm:rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-100 transition-all duration-300 group-hover:text-white`}>
                                <option.icon
                                    className={`w-5 h-5 sm:w-4 sm:h-4 transition-all duration-300 ${option.color.replace('bg-', 'text-')} group-hover:text-white ${option.hoverOnly ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
                                />
                            </div>
                            <span className={`font-bold text-base sm:text-sm leading-tight whitespace-nowrap transition-colors ${currentStatus === option.value ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                                {option.label}
                            </span>
                        </button>
                    ))}

                    <div className="h-px bg-white/10 my-2 sm:my-1" />

                    {currentStatus ? (
                        <button
                            onClick={handleRemove}
                            className="w-full px-4 py-3.5 sm:px-3 sm:py-2.5 text-left text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-4 sm:gap-3 text-base sm:text-sm font-bold rounded-xl sm:rounded-lg transition-colors duration-200 group"
                        >
                            <div className={`${isMobileViewport ? 'w-10 h-10' : 'w-8 h-8'} flex items-center justify-center rounded-xl sm:rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors`}>
                                <Trash2 className="w-5 h-5 sm:w-4 sm:h-4" />
                            </div>
                            Remove from List
                        </button>
                    ) : null}

                    {showEditInDropdown ? (
                        <button
                            onClick={handleOpenEditModal}
                            className="w-full px-4 py-3.5 sm:px-3 sm:py-2.5 text-left text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-4 sm:gap-3 text-base sm:text-sm font-bold rounded-xl sm:rounded-lg transition-colors duration-200 group"
                        >
                            <div className={`${isMobileViewport ? 'w-10 h-10' : 'w-8 h-8'} flex items-center justify-center rounded-xl sm:rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors`}>
                                <Pencil className="w-5 h-5 sm:w-4 sm:h-4" />
                            </div>
                            Edit
                        </button>
                    ) : null}
                </div>
            </>
        );
    };

    if (!currentStatus) {
        return (
            <>
                <div className="relative w-full" ref={dropdownRef}>
                    <button
                        onClick={toggleDropdown}
                        disabled={isLoading}
                        className={`w-full flex items-center justify-center gap-2 px-3 transition-all duration-300 font-bold text-sm ${compactSidebar
                            ? 'h-9 rounded-lg bg-dark-100 text-gray-400 hover:text-white whitespace-nowrap'
                            : 'px-6 py-3 rounded-xl bg-dark-200 text-gray-300 border border-dark-50'}`}
                    >
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                        )}
                        Add to List
                        <ChevronDown className={`w-4 h-4 ml-1 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {renderDropdownMenu()}
                </div>

                <ListEntryEditModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    onSave={handleSaveDetailedEntry}
                    initialEntry={getModalEntry()}
                    totalEpisodes={totalEpisodes}
                    statusOptions={STATUS_OPTIONS}
                    isSaving={isLoading}
                />
            </>
        );
    }

    return (
        <>
            <div className="w-full relative status-selector-container">
                <div className={`relative flex items-center justify-between z-10 ${compactSidebar ? 'p-0 bg-transparent border-none' : 'p-1.5 sm:p-2 bg-dark-200 rounded-2xl border border-dark-50'}`}>
                    <div
                        className={compactSidebar ? 'relative flex-1 min-w-0' : 'relative flex-shrink-0'}
                        ref={dropdownRef}
                    >
                        <button
                            onClick={toggleDropdown}
                            disabled={isLoading}
                            className={`flex items-center justify-center gap-2 px-3 rounded-lg font-bold text-xs sm:text-sm transition-all duration-300 w-full ${compactSidebar ? 'h-9' : 'py-2.5 border'} ${currentOption
                                ? `${compactSidebar
                                    ? 'text-white hover:brightness-110'
                                    : `${currentOption.color} text-white hover:brightness-110 border-transparent`}`
                                : 'bg-dark-100 text-gray-400 border-gray-700 hover:border-gray-600'}`}
                            style={compactSidebar && currentOption ? {
                                backgroundColor: 'var(--anime-accent, var(--color-accent))',
                            } : undefined}
                        >
                            {isLoading ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : !compactSidebar && currentOption?.icon ? (
                                <currentOption.icon className="w-4 h-4" />
                            ) : (
                                <div className={`${compactSidebar ? 'hidden' : 'w-4 h-4'}`} />
                            )}
                            <span className={compactSidebar ? 'inline' : 'hidden sm:inline'}>{currentOption?.label}</span>
                            <ChevronDown className={`w-3.5 h-3.5 ml-0.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {renderDropdownMenu()}
                    </div>

                    {!compactSidebar && (
                        <div className="flex items-center justify-center flex-1 px-2 sm:px-4 min-w-[120px]">
                            <div className="flex items-center gap-2 sm:gap-3 bg-dark-100/50 rounded-xl p-1 border border-white/5">
                                <button
                                    onClick={() => handleEpisodeChange(episodesWatched - 1)}
                                    disabled={isLoading || episodesWatched <= 0}
                                    className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-dark-200 hover:bg-white/10 text-gray-400 hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-dark-200 flex-shrink-0"
                                >
                                    <Minus className="w-4 h-4" />
                                </button>

                                <div className="flex items-baseline gap-0.5 px-1 min-w-[50px] sm:min-w-[70px] justify-center">
                                    <input
                                        type="text"
                                        value={localEpisodes}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            if (nextValue === '' || /^\d+$/.test(nextValue)) {
                                                setLocalEpisodes(nextValue);
                                            }
                                        }}
                                        onBlur={() => {
                                            const nextValue = localEpisodes === '' ? 0 : parseInt(localEpisodes, 10);
                                            handleEpisodeChange(nextValue);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.target.blur();
                                            }
                                        }}
                                        className="w-9 sm:w-11 bg-transparent text-white font-black text-base sm:text-lg tabular-nums tracking-tight text-center focus:outline-none focus:bg-white/5 rounded-lg transition-all"
                                    />
                                    <span className="text-gray-500 text-xs sm:text-sm font-bold">/</span>
                                    <span className="text-gray-400 text-xs sm:text-sm font-bold tabular-nums">
                                        {totalEpisodes || '?'}
                                    </span>
                                </div>

                                <button
                                    onClick={() => handleEpisodeChange(episodesWatched + 1)}
                                    disabled={isLoading || (totalEpisodes > 0 && episodesWatched >= totalEpisodes)}
                                    className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-accent/20 disabled:hover:text-accent flex-shrink-0"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className={`mt-1.5 w-full flex items-center gap-2 ${compactSidebar ? '' : 'hidden'}`}>
                    <div className="flex-1 h-1 bg-dark-100/50 rounded-full overflow-hidden border border-white/5">
                        <div
                            style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                            className={`h-full rounded-full transition-all duration-700 ease-out ${totalEpisodes > 0 && episodesWatched >= totalEpisodes
                                ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                                : 'bg-accent shadow-[0_0_8px_rgba(var(--color-accent-rgb),0.4)]'}`}
                        />
                    </div>
                    <div className="flex items-center gap-1.5 bg-dark-100/50 px-2 py-0.5 rounded-md border border-white/5">
                        <span className="text-[10px] font-black text-white/90 tabular-nums leading-none">{episodesWatched}</span>
                        <span className="text-[10px] font-bold text-gray-600 leading-none">/</span>
                        <span className="text-[10px] font-bold text-gray-500 tabular-nums leading-none">{totalEpisodes || '?'}</span>
                    </div>
                </div>

                {!compactSidebar && (
                    <div className="absolute -bottom-1 left-4 right-4 h-1 sm:h-1.5 bg-dark-100 rounded-b-xl overflow-hidden opacity-80 z-0">
                        <div
                            style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                            className={`h-full rounded-r-full ${totalEpisodes > 0 && episodesWatched >= totalEpisodes ? 'bg-green-500' : 'bg-accent'}`}
                        />
                    </div>
                )}
            </div>

            <ListEntryEditModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSave={handleSaveDetailedEntry}
                initialEntry={getModalEntry()}
                totalEpisodes={totalEpisodes}
                statusOptions={STATUS_OPTIONS}
                isSaving={isLoading}
            />
        </>
    );
}
