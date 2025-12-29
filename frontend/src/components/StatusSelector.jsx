import { useState, useEffect } from 'react';
import { ChevronDown, Check, Plus, X } from 'lucide-react';
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

export default function StatusSelector({ animeId, initialStatus, onUpdate }) {
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
            let response;
            if (listId) {
                // Update existing
                response = await listApi.update(listId, {
                    status: newStatus,
                    score,
                    episodes_watched: episodesWatched
                });
            } else {
                // Create new
                response = await listApi.add({
                    anime_id: animeId,
                    status: newStatus,
                    score,
                    episodes_watched: episodesWatched
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

    const currentOption = STATUS_OPTIONS.find(opt => opt.value === currentStatus);

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                disabled={isLoading}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all
                    ${currentOption
                        ? `${currentOption.color} text-white hover:opacity-90`
                        : 'bg-dark-100 text-gray-300 border border-gray-700 hover:border-accent hover:text-white'}`}
            >
                {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : currentOption ? (
                    <>
                        <Check className="w-5 h-5" />
                        {currentOption.label}
                    </>
                ) : (
                    <>
                        <Plus className="w-5 h-5" />
                        Add to List
                    </>
                )}
                <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute top-full left-0 mt-2 w-56 bg-dark-100 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
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
    );
}
