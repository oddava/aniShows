import { useState, useEffect } from 'react';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Check, Play, Pause, Bookmark, Trash2, Minus, Plus } from 'lucide-react';
import logger from '../utils/logger';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', color: 'bg-green-500', icon: Play },
    { value: 'Completed', label: 'Completed', color: 'bg-blue-500', icon: Check },
    { value: 'On Hold', label: 'On Hold', color: 'bg-yellow-500', icon: Pause },
    { value: 'Dropped', label: 'Dropped', color: 'bg-red-500', icon: Trash2 },
    { value: 'Plan to Watch', label: 'Plan to Watch', color: 'bg-gray-500', icon: Bookmark },
];

export default function StatusSelector({ animeId, initialStatus, onUpdate, totalEpisodes, isOwnProfile = true }) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Status state
    const [currentStatus, setCurrentStatus] = useState(initialStatus?.status || null);
    const [score, setScore] = useState(initialStatus?.score || 0);
    const [episodesWatched, setEpisodesWatched] = useState(initialStatus?.episodes_watched || 0);
    const [listId, setListId] = useState(initialStatus?.id || null);

    useEffect(() => {
        if (initialStatus) {
            setCurrentStatus(initialStatus.status);
            setScore(initialStatus.score);
            setEpisodesWatched(initialStatus.episodes_watched);
            setListId(initialStatus.id);
        }
    }, [initialStatus]);

    if (!isAuthenticated || !isOwnProfile) return null;

    const handleStatusChange = async (newStatus) => {
        setIsLoading(true);
        try {
            let nextEpisodes = episodesWatched;

            if (newStatus === 'Completed' && totalEpisodes && totalEpisodes > 0) {
                nextEpisodes = totalEpisodes;
                setEpisodesWatched(totalEpisodes);
            } else if (newStatus === 'Plan to Watch') {
                nextEpisodes = 0;
                setEpisodesWatched(0);
            }

            let response;
            if (listId) {
                response = await listApi.update(listId, {
                    status: newStatus,
                    score,
                    episodes_watched: nextEpisodes
                });
            } else {
                response = await listApi.add({
                    anime_id: animeId,
                    status: newStatus,
                    score,
                    episodes_watched: nextEpisodes
                });
                setListId(response.data.id);
            }

            setCurrentStatus(newStatus);
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            if (onUpdate) onUpdate(response.data);
            setIsOpen(false);
        } catch (error) {
            logger.error('Failed to update status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemove = async () => {
        if (!listId) return;
        setIsLoading(true);
        try {
            await listApi.remove(listId);
            setCurrentStatus(null);
            setListId(null);
            setScore(0);
            setEpisodesWatched(0);
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            if (onUpdate) onUpdate(null);
            setIsOpen(false);
        } catch (error) {
            logger.error('Failed to remove entry:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEpisodeChange = async (newEpisodes) => {
        if (newEpisodes < 0 || (totalEpisodes && newEpisodes > totalEpisodes)) return;

        const prevEpisodes = episodesWatched;
        const prevStatus = currentStatus;

        setEpisodesWatched(newEpisodes);

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
            if (onUpdate) onUpdate(response.data);
        } catch (error) {
            logger.error('Failed to update episodes:', error);
            setEpisodesWatched(prevEpisodes);
            setCurrentStatus(prevStatus);
        }
    };

    const currentOption = STATUS_OPTIONS.find(opt => opt.value === currentStatus);
    const progressPercentage = totalEpisodes ? Math.round((episodesWatched / totalEpisodes) * 100) : 0;

    // Compact inline design
    if (!currentStatus) {
        return (
            <div className="relative w-full">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all bg-dark-100 text-gray-300 border border-gray-700 hover:border-accent hover:text-white"
                >
                    {isLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <Plus className="w-5 h-5" />
                    )}
                    Add to List
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-10"
                            onClick={() => setIsOpen(false)}
                        />
                        <div className="absolute top-full left-0 mt-2 w-48 bg-dark-100 border border-gray-700 rounded-xl shadow-2xl z-[100] overflow-hidden animate-fade-in py-1">
                            {STATUS_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => handleStatusChange(option.value)}
                                    className="w-full px-4 py-2.5 text-left flex items-center gap-3 transition-all group hover:bg-white/5"
                                >
                                    <div className={`w-7 h-7 flex items-center justify-center rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-30 transition-all`}>
                                        <option.icon className={`w-3.5 h-3.5 ${option.color.replace('bg-', 'text-')}`} />
                                    </div>
                                    <span className="font-semibold text-sm text-gray-300 group-hover:text-white">
                                        {option.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="w-full">
            {/* Main Controls Row */}
            <div className="flex items-center gap-1.5 sm:gap-2 bg-dark-100/50 p-1.5 sm:p-2 rounded-xl border border-gray-800">
                {/* Status Dropdown */}
                <div className="relative flex-shrink-0">
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        disabled={isLoading}
                        className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-lg font-medium text-xs sm:text-sm transition-all whitespace-nowrap
                            ${currentOption
                                ? `${currentOption.color} text-white hover:opacity-90`
                                : 'bg-dark-100 text-gray-300 border border-gray-700 hover:border-accent hover:text-white'}`}
                    >
                        {isLoading ? (
                            <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <currentOption.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                        <span className="hidden sm:inline">{currentOption.label}</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setIsOpen(false)}
                            />
                            <div className="absolute top-full left-0 mt-2 w-44 sm:w-48 bg-dark-100 border border-gray-700 rounded-xl shadow-2xl z-[100] overflow-hidden animate-fade-in py-1">
                                {STATUS_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => handleStatusChange(option.value)}
                                        className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 text-left flex items-center gap-2 sm:gap-3 transition-all group
                                            ${currentStatus === option.value ? 'bg-accent/10' : 'hover:bg-white/5'}`}
                                    >
                                        <div className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-30 transition-all`}>
                                            <option.icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${option.color.replace('bg-', 'text-')}`} />
                                        </div>
                                        <span className={`font-semibold text-xs sm:text-sm transition-colors ${currentStatus === option.value ? 'text-accent' : 'text-gray-300 group-hover:text-white'}`}>
                                            {option.label}
                                        </span>
                                        {currentStatus === option.value && <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-auto text-accent" />}
                                    </button>
                                ))}

                                <div className="border-t border-gray-700 mt-1">
                                    <button
                                        onClick={handleRemove}
                                        className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2 text-xs sm:text-sm"
                                    >
                                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                        Remove
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Divider */}
                <div className="w-px h-6 sm:h-8 bg-gray-700/50 flex-shrink-0" />

                {/* Episode Counter with Arrows */}
                <div className="flex items-center gap-1 sm:gap-2 flex-1 justify-center">
                    <button
                        onClick={() => handleEpisodeChange(episodesWatched - 1)}
                        disabled={isLoading || episodesWatched <= 0}
                        className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-lg bg-dark-200 hover:bg-dark-300 text-gray-400 hover:text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                    >
                        <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>

                    <div className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 min-w-[60px] sm:min-w-[70px] justify-center">
                        <span className="text-white font-bold text-xs sm:text-sm tabular-nums">{episodesWatched}</span>
                        <span className="text-gray-500 text-[10px] sm:text-xs">/</span>
                        <span className="text-gray-400 text-xs sm:text-sm tabular-nums">{totalEpisodes || '?'}</span>
                    </div>

                    <button
                        onClick={() => handleEpisodeChange(episodesWatched + 1)}
                        disabled={isLoading || (totalEpisodes > 0 && episodesWatched >= totalEpisodes)}
                        className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-lg bg-accent/10 hover:bg-accent text-accent hover:text-white transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                    >
                        <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-2 relative h-1.5 sm:h-2 bg-dark-200 rounded-full overflow-hidden">
                <div
                    style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                    className={`h-full transition-all duration-500 ${totalEpisodes > 0 && episodesWatched >= totalEpisodes
                        ? 'bg-green-500'
                        : 'bg-accent'
                        }`}
                />
            </div>
        </div>
    );
}
