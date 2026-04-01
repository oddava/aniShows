import { useState, useEffect, useRef } from 'react';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Check, Pause, Bookmark, Trash2, Minus, Plus, Eye } from 'lucide-react';
import logger from '../utils/logger';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', color: 'bg-green-500', icon: Eye },
    { value: 'Completed', label: 'Completed', color: 'bg-blue-500', icon: Check, hoverOnly: true },
    { value: 'On Hold', label: 'On Hold', color: 'bg-yellow-500', icon: Pause },
    { value: 'Dropped', label: 'Dropped', color: 'bg-red-500', icon: Trash2 },
    { value: 'Plan to Watch', label: 'Plan to Watch', color: 'bg-gray-500', icon: Bookmark },
];

export default function StatusSelector({ animeId, initialStatus, onUpdate, totalEpisodes, isOwnProfile = true, compactSidebar = false }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Status state
    const [currentStatus, setCurrentStatus] = useState(initialStatus?.status || null);
    const [episodesWatched, setEpisodesWatched] = useState(initialStatus?.episodes_watched || 0);
    const [localEpisodes, setLocalEpisodes] = useState(initialStatus?.episodes_watched || 0);
    const [listId, setListId] = useState(initialStatus?.id || null);

    const dropdownRef = useRef(null);

    const closeDropdown = () => {
        setIsOpen(false);
    };

    const toggleDropdown = () => {
        if (isOpen) {
            closeDropdown();
        } else {
            setIsOpen(true);
        }
    };

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                closeDropdown();
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (initialStatus) {
            setCurrentStatus(initialStatus.status);
            setEpisodesWatched(initialStatus.episodes_watched);
            setLocalEpisodes(initialStatus.episodes_watched);
            setListId(initialStatus.id);
        }
    }, [initialStatus]);

    if (!isAuthenticated || !isOwnProfile) return null;

    const handleStatusChange = async (newStatus) => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            let nextEpisodes = episodesWatched;

            if (newStatus === 'Completed' && totalEpisodes && totalEpisodes > 0) {
                nextEpisodes = totalEpisodes;
                setEpisodesWatched(totalEpisodes);
                setLocalEpisodes(totalEpisodes);
            } else if (newStatus === 'Plan to Watch') {
                nextEpisodes = 0;
                setEpisodesWatched(0);
                setLocalEpisodes(0);
            }

            let response;
            if (listId) {
                response = await listApi.update(listId, {
                    status: newStatus,
                    episodes_watched: nextEpisodes,
                });
            } else {
                response = await listApi.add({
                    anime_id: animeId,
                    status: newStatus,
                    episodes_watched: nextEpisodes,
                });
            }

            const isAdding = !currentStatus;

            if (isAdding) {
                setCurrentStatus(newStatus);
                setListId(response.data.id);
                setIsOpen(false);
                queryClient.invalidateQueries({ queryKey: ['lists'] });
                queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
                if (onUpdate) onUpdate(response.data);
            } else {
                setCurrentStatus(newStatus);
                queryClient.invalidateQueries({ queryKey: ['lists'] });
                queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
                if (onUpdate) onUpdate(response.data);
                closeDropdown();
            }
        } catch (error) {
            logger.error('Failed to update status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemove = async () => {
        if (!listId || isLoading) return;
        setIsLoading(true);
        try {
            await listApi.remove(listId);

            // Immediately switch back to the "Add to List" button
            setCurrentStatus(null);
            setListId(null);
            setEpisodesWatched(0);
            setLocalEpisodes(0);
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            if (onUpdate) onUpdate(null);
        } catch (error) {
            logger.error('Failed to remove entry:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEpisodeChange = async (newEpisodes) => {
        if (!listId || isLoading) {
            return;
        }

        if (newEpisodes < 0 || (totalEpisodes && newEpisodes > totalEpisodes)) {
            setLocalEpisodes(episodesWatched);
            return;
        }

        const prevEpisodes = episodesWatched;
        const prevStatus = currentStatus;

        setIsLoading(true);
        setEpisodesWatched(newEpisodes);
        setLocalEpisodes(newEpisodes);

        let newStatus = currentStatus;
        if (newEpisodes === totalEpisodes && totalEpisodes > 0) {
            newStatus = 'Completed';
        } else if (currentStatus === 'Completed' && newEpisodes < totalEpisodes) {
            newStatus = 'Watching';
        }

        if (newStatus !== currentStatus) {
            setCurrentStatus(newStatus);
        }

        try {
            const dataToUpdate = { episodes_watched: newEpisodes };
            if (newStatus !== prevStatus) {
                dataToUpdate.status = newStatus;
            }

            const response = await listApi.update(listId, dataToUpdate);

            if (response.data.status !== newStatus) {
                setCurrentStatus(response.data.status);
            }

            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            if (onUpdate) onUpdate(response.data);
        } catch (error) {
            logger.error('Failed to update episodes:', error);
            setEpisodesWatched(prevEpisodes);
            setLocalEpisodes(prevEpisodes);
            setCurrentStatus(prevStatus);
        } finally {
            setIsLoading(false);
        }
    };

    const currentOption = STATUS_OPTIONS.find(opt => opt.value === currentStatus);
    const progressPercentage = totalEpisodes ? Math.round((episodesWatched / totalEpisodes) * 100) : 0;

    // Premium Add to List button when no status
    if (!currentStatus) {
        return (
            <div className="relative w-full" ref={dropdownRef}>
                <button
                    onClick={toggleDropdown}
                    disabled={isLoading}
                    className={`w-full flex items-center justify-center gap-2 px-3 transition-all duration-300 font-bold text-sm
                        ${compactSidebar 
                            ? 'py-2.5 rounded-lg bg-dark-100 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600' 
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

                {isOpen && (
                    <div className="absolute top-full left-0 right-0 mt-3 p-2 bg-dark-100  border border-dark-50 rounded-2xl shadow-none z-[100]">
                        {STATUS_OPTIONS.map((option, index) => (
                            <button
                                key={option.value}
                                onClick={() => handleStatusChange(option.value)}
                                className="w-full px-4 py-3 text-left flex items-center gap-3 transition-all duration-200 group hover:bg-white/5 rounded-xl"
                            >
                                <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-100 transition-all duration-300 group-hover:text-white`}>
                                    {option.icon && (
                                        <option.icon className={`w-4 h-4 transition-all duration-300 ${option.color.replace('bg-', 'text-')} group-hover:text-white ${option.hoverOnly ? 'opacity-0 group-hover:opacity-100  ' : 'opacity-100'}`} />
                                    )}
                                </div>
                                <span className="font-bold text-sm text-gray-300 group-hover:text-white">
                                    {option.label}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="w-full relative status-selector-container">
            {/* Sleek Main Controls Bar */}
            <div className={`relative flex items-center justify-between z-10 
                ${compactSidebar 
                    ? 'p-0 bg-transparent border-none' 
                    : 'p-1.5 sm:p-2 bg-dark-200 rounded-2xl border border-dark-50'}`}
            >

                {/* Status Dropdown - Left */}
                <div
                    className={compactSidebar ? 'relative flex-1 min-w-0' : 'relative flex-shrink-0'}
                    ref={dropdownRef}
                >
                    <button
                        onClick={toggleDropdown}
                        disabled={isLoading}
                        className={`flex items-center justify-center gap-2 px-3 rounded-lg font-bold text-xs sm:text-sm transition-all duration-300 border w-full
                            ${compactSidebar ? 'h-9' : 'py-2.5'}
                            ${currentOption
                                ? `${compactSidebar
                                    ? 'text-white hover:brightness-110 border-transparent shadow-md'
                                    : `${currentOption.color} text-white hover:brightness-110 border-transparent shadow-md shadow-${currentOption.color.replace('bg-', '')}/20`}`
                                : 'bg-dark-100 text-gray-400 border-gray-700 hover:border-gray-600'}`}
                        style={compactSidebar && currentOption ? {
                            backgroundColor: 'var(--anime-accent, var(--color-accent))',
                            boxShadow: '0 10px 24px color-mix(in srgb, var(--anime-accent, var(--color-accent)) 24%, transparent)',
                        } : undefined}
                    >
                        {isLoading ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : !compactSidebar && currentOption && currentOption.icon ? (
                            <currentOption.icon className="w-4 h-4" />
                        ) : (
                            <div className={`${compactSidebar ? 'hidden' : 'w-4 h-4'}`} />
                        )}
                        <span className={compactSidebar ? 'inline' : 'hidden sm:inline'}>{currentOption.label}</span>
                        <ChevronDown className={`w-3.5 h-3.5 ml-0.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Status Menu */}
                    {isOpen && (
                        <div className="absolute top-full left-0 mt-3 w-56 p-2 bg-dark-100  border border-dark-50 rounded-2xl shadow-none z-[100]">
                            {STATUS_OPTIONS.map((option, index) => (
                                <button
                                    key={option.value}
                                    onClick={() => handleStatusChange(option.value)}
                                    className={`w-full px-3 py-2.5 text-left flex items-center gap-3 transition-all duration-200 group rounded-xl
                                        ${currentStatus === option.value ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                >
                                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-100 transition-all duration-300 group-hover:text-white`}>
                                        {option.icon && (
                                            <option.icon className={`w-4 h-4 transition-all duration-300 ${currentStatus === option.value ? option.color.replace('bg-', 'text-') : option.color.replace('bg-', 'text-')} group-hover:text-white ${option.hoverOnly ? 'opacity-0 group-hover:opacity-100  ' : 'opacity-100'}`} />
                                        )}
                                    </div>
                                    <span className={`font-bold text-sm transition-colors ${currentStatus === option.value ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                                        {option.label}
                                    </span>
                                </button>
                            ))}
                            <div className="h-px bg-white/10 my-1" />
                            <button
                                onClick={handleRemove}
                                className="w-full px-3 py-2.5 text-left text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-3 text-sm font-bold rounded-xl transition-colors duration-200 group"
                            >
                                <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </div>
                                Remove from List
                            </button>
                        </div>
                    )}
                </div>

                {/* Episode Counter - Center */}
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
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '' || /^\d+$/.test(val)) {
                                            setLocalEpisodes(val);
                                        }
                                    }}
                                    onBlur={() => {
                                        const val = localEpisodes === '' ? 0 : parseInt(localEpisodes);
                                        handleEpisodeChange(val);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.target.blur();
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

            {/* Progress Row (Attached below for sidebar, absolute for normal) */}
            <div className={`mt-1.5 w-full flex items-center gap-2 ${compactSidebar ? '' : 'hidden'}`}>
                <div className="flex-1 h-1 bg-dark-100/50 rounded-full overflow-hidden border border-white/5">
                    <div
                        style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                        className={`h-full rounded-full transition-all duration-700 ease-out ${totalEpisodes > 0 && episodesWatched >= totalEpisodes
                            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                            : 'bg-accent shadow-[0_0_8px_rgba(var(--color-accent-rgb),0.4)]'
                            }`}
                    />
                </div>
                <div className="flex items-center gap-1.5 bg-dark-100/50 px-2 py-0.5 rounded-md border border-white/5">
                    <span className="text-[10px] font-black text-white/90 tabular-nums leading-none">{episodesWatched}</span>
                    <span className="text-[10px] font-bold text-gray-600 leading-none">/</span>
                    <span className="text-[10px] font-bold text-gray-500 tabular-nums leading-none">{totalEpisodes || '?'}</span>
                </div>
            </div>

            {/* Old Progress Bar (Keep for non-sidebar mode) */}
            {!compactSidebar && (
                <div className="absolute -bottom-1 left-4 right-4 h-1 sm:h-1.5 bg-dark-100 rounded-b-xl overflow-hidden opacity-80 z-0">
                    <div
                        style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                        className={`h-full rounded-r-full ${totalEpisodes > 0 && episodesWatched >= totalEpisodes
                            ? 'bg-green-500'
                            : 'bg-accent'
                            }`}
                    />
                </div>
            )}

        </div>
    );
}
