import { useState, useEffect } from 'react';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Check, Plus, X, Minus, Play, Pause, Bookmark, Trash2 } from 'lucide-react';

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
        } else {
            setCurrentStatus(null);
            setScore(0);
            setEpisodesWatched(0);
            setListId(null);
        }
    }, [initialStatus]);

    if (!isAuthenticated || !isOwnProfile) return null;

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
                            <currentOption.icon className="w-5 h-5" />
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
                        <div className="absolute top-full left-0 mt-2 w-full bg-dark-100 border border-gray-700 rounded-xl shadow-2xl z-[100] overflow-hidden animate-fade-in py-1">
                            {STATUS_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => handleStatusChange(option.value)}
                                    className={`w-full px-4 py-2.5 text-left flex items-center gap-3 transition-all group
                                        ${currentStatus === option.value ? 'bg-accent/10' : 'hover:bg-white/5'}`}
                                >
                                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-30 transition-all`}>
                                        <option.icon className={`w-4 h-4 ${option.color.replace('bg-', 'text-')}`} />
                                    </div>
                                    <span className={`font-semibold text-sm transition-colors ${currentStatus === option.value ? 'text-accent' : 'text-gray-300 group-hover:text-white'}`}>
                                        {option.label}
                                    </span>
                                    {currentStatus === option.value && <Check className="w-4 h-4 ml-auto text-accent" />}
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
                <div className="mt-2 pt-3 border-t border-gray-800/50 animate-fade-in group/progress">
                    <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest group-hover/progress:text-gray-400 transition-colors">Progress</span>
                        <div className="flex items-center gap-1.5">
                            <div className="relative group/input">
                                <input
                                    type="number"
                                    value={episodesWatched}
                                    onChange={(e) => handleEpisodeChange(parseInt(e.target.value) || 0)}
                                    className="w-14 bg-dark-200 border border-gray-700/50 rounded-lg px-1.5 py-0.5 text-white text-center font-bold text-xs focus:border-accent focus:ring-2 focus:ring-accent/10 outline-none transition-all placeholder:text-gray-700 hover:border-gray-600"
                                    min="0"
                                    max={totalEpisodes || 9999}
                                />
                                <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-accent text-[8px] text-white font-black uppercase rounded opacity-0 group-hover/input:opacity-100 transition-opacity whitespace-nowrap pointer-events-none tracking-tighter shadow-lg">
                                    EPISODE
                                </div>
                            </div>
                            <span className="text-gray-600 font-bold text-xs">/</span>
                            <span className="text-gray-400 font-bold text-xs">{totalEpisodes || '?'}</span>
                        </div>
                    </div>

                    <div className="relative h-4 flex items-center group/track">
                        {/* Background Track */}
                        <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-2.5 bg-gray-800/80 rounded-full overflow-hidden shadow-inner">
                            <div
                                style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                                className={`h-full transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) ${episodesWatched >= totalEpisodes ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-accent shadow-[0_0_8px_rgba(139,92,246,0.4)]'}`}
                            />
                        </div>

                        {/* Interactive Input */}
                        <input
                            type="range"
                            min="0"
                            max={totalEpisodes || 100}
                            value={episodesWatched}
                            onChange={(e) => handleEpisodeChange(parseInt(e.target.value))}
                            disabled={!totalEpisodes}
                            className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 ${totalEpisodes > 100 ? 'hover:opacity-5' : ''}`}
                        />

                        {/* Thumb (Visual Only) */}
                        {totalEpisodes > 0 && (
                            <div
                                className={`absolute w-3 h-3 bg-white rounded-full shadow-2xl border-2 border-accent top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-300 
                                    ${totalEpisodes > 100 ? 'scale-75 group-hover/track:scale-100 opacity-0 group-hover/track:opacity-100' : 'scale-100 group-hover/track:scale-125'}`}
                                style={{ left: `${Math.min(progressPercentage, 100)}%`, transform: `translate(-50%, -50%)` }}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
