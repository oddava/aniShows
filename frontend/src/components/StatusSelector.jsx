import { useState, useEffect } from 'react';
import { ChevronDown, Check, Plus, X, Minus } from 'lucide-react';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', color: 'bg-green-500' },
    { value: 'Completed', label: 'Completed', color: 'bg-blue-500' },
    { value: 'On Hold', label: 'On Hold', color: 'bg-yellow-500' },
    { value: 'Dropped', label: 'Dropped', color: 'bg-red-500' },
    { value: 'Plan to Watch', label: 'Plan to Watch', color: 'bg-gray-500' },
];

export default function StatusSelector({ animeId, initialStatus, onUpdate, totalEpisodes }) {
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

    if (!isAuthenticated) return null;

    const handleStatusChange = async (newStatus) => {
        setIsLoading(true);
        try {
            // Optimistic logic
            let nextEpisodes = episodesWatched;

            // Auto-complete: Set to max
            if (newStatus === 'Completed' && totalEpisodes && totalEpisodes > 0) {
                nextEpisodes = totalEpisodes;
                setEpisodesWatched(totalEpisodes);
            }
            // Plan to Watch: Reset to 0
            else if (newStatus === 'Plan to Watch') {
                nextEpisodes = 0;
                setEpisodesWatched(0);
            }

            let response;
            if (listId) {
                // Update existing
                response = await listApi.update(listId, {
                    status: newStatus,
                    score,
                    episodes_watched: nextEpisodes
                });
            } else {
                // Create new
                response = await listApi.add({
                    anime_id: animeId,
                    status: newStatus,
                    score,
                    episodes_watched: nextEpisodes
                });
                setListId(response.data.id);
            }

            setCurrentStatus(newStatus);
            // Invalidate the lists cache so Profile page refreshes correctly
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            if (onUpdate) onUpdate(response.data);
            setIsOpen(false);
        } catch (error) {
            console.error('Failed to update status:', error);
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
            // Invalidate the lists cache
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            if (onUpdate) onUpdate(null);
            setIsOpen(false);
        } catch (error) {
            console.error('Failed to remove entry:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEpisodeChange = async (newEpisodes) => {
        if (newEpisodes < 0 || (totalEpisodes && newEpisodes > totalEpisodes)) return;

        // Optimistic update
        const prevEpisodes = episodesWatched;
        const prevStatus = currentStatus;

        setEpisodesWatched(newEpisodes);

        // Auto-status sync logic
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

            // Check if status changed in backend differently than expected
            if (response.data.status !== newStatus) {
                setCurrentStatus(response.data.status);
            }

            queryClient.invalidateQueries({ queryKey: ['lists'] });
            if (onUpdate) onUpdate(response.data);
        } catch (error) {
            console.error('Failed to update episodes:', error);
            setEpisodesWatched(prevEpisodes);
            setCurrentStatus(prevStatus);
        }
    };

    const currentOption = STATUS_OPTIONS.find(opt => opt.value === currentStatus);
    const progressPercentage = totalEpisodes ? Math.round((episodesWatched / totalEpisodes) * 100) : 0;

    return (
        <div className="flex flex-col gap-3 min-w-[300px]">
            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={isLoading}
                    className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl font-medium transition-all shadow-lg
                        ${currentOption
                            ? `${currentOption.color} text-white hover:opacity-90`
                            : 'bg-dark-100 text-gray-300 border border-gray-700 hover:border-accent hover:text-white'}`}
                >
                    <div className="flex items-center gap-2">
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : currentOption ? (
                            <Check className="w-5 h-5" />
                        ) : (
                            <Plus className="w-5 h-5" />
                        )}
                        {currentOption ? currentOption.label : 'Add to List'}
                    </div>
                    <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-10"
                            onClick={() => setIsOpen(false)}
                        />
                        <div className="absolute top-full left-0 mt-2 w-full bg-dark-100 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
                            {STATUS_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => handleStatusChange(option.value)}
                                    className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors hover:bg-dark-50
                                        ${currentStatus === option.value ? 'text-accent' : 'text-gray-300'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${option.color}`} />
                                    {option.label}
                                </button>
                            ))}

                            {currentStatus && (
                                <div className="border-t border-gray-700 mt-1">
                                    <button
                                        onClick={handleRemove}
                                        className="w-full px-4 py-3 text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                    >
                                        <X className="w-4 h-4" />
                                        Remove from List
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Episode Tracker */}
            {currentStatus && (
                <div className="bg-dark-100/50 p-3 rounded-xl border border-gray-700/50 space-y-3 backdrop-blur-sm animate-fade-in">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Progress</span>
                        <div className="flex items-center gap-2">
                            <span className="text-white font-medium font-mono text-lg">
                                {episodesWatched}
                            </span>
                            <span className="text-gray-500">
                                / {totalEpisodes || '?'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => handleEpisodeChange(episodesWatched - 1)}
                            disabled={episodesWatched <= 0}
                            className="p-1.5 hover:bg-dark-50 rounded-lg text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                        >
                            <Minus className="w-4 h-4" />
                        </button>

                        <div className="flex-1 relative h-6 flex items-center group">
                            {/* Background Track */}
                            <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                                    className={`h-full transition-all duration-150 ${episodesWatched >= totalEpisodes ? 'bg-green-500' : 'bg-accent'}`}
                                />
                            </div>

                            {/* Interactive Input */}
                            <input
                                type="range"
                                min="0"
                                max={totalEpisodes || 100} // Fallback if unknown
                                value={episodesWatched}
                                onChange={(e) => handleEpisodeChange(parseInt(e.target.value))}
                                disabled={!totalEpisodes}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />

                            {/* Thumb (Visual Only) */}
                            {totalEpisodes && (
                                <div
                                    className="absolute w-4 h-4 bg-white rounded-full shadow-lg border-2 border-accent top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-150 group-hover:scale-125"
                                    style={{ left: `${Math.min(progressPercentage, 100)}%`, transform: `translate(-50%, -50%)` }}
                                />
                            )}
                        </div>

                        <button
                            onClick={() => handleEpisodeChange(episodesWatched + 1)}
                            disabled={totalEpisodes && episodesWatched >= totalEpisodes}
                            className="p-1.5 hover:bg-dark-50 rounded-lg text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
