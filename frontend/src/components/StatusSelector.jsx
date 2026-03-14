import { useState, useEffect, useRef } from 'react';
import { listApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Check, Play, Pause, Bookmark, Trash2, Minus, Plus, Star, RotateCcw, StickyNote, Calendar, Edit3, X, Eye } from 'lucide-react';
import logger from '../utils/logger';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', color: 'bg-green-500', icon: Eye },
    { value: 'Completed', label: 'Completed', color: 'bg-blue-500', icon: Check, hoverOnly: true },
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
    const [localEpisodes, setLocalEpisodes] = useState(initialStatus?.episodes_watched || 0);
    const [listId, setListId] = useState(initialStatus?.id || null);

    // Detail fields
    const [showDetails, setShowDetails] = useState(false);
    const [notes, setNotes] = useState(initialStatus?.notes || '');
    const [startedAt, setStartedAt] = useState(initialStatus?.started_at || '');
    const [finishedAt, setFinishedAt] = useState(initialStatus?.finished_at || '');
    const [isRewatching, setIsRewatching] = useState(initialStatus?.is_rewatching || false);

    const dropdownRef = useRef(null);
    const detailsRef = useRef(null);

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

    const closeDetails = () => {
        setShowDetails(false);
    };

    const toggleDetails = () => {
        if (showDetails) {
            closeDetails();
        } else {
            setShowDetails(true);
        }
    };

    // Close dropdowns on outside click
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                closeDropdown();
            }
            if (detailsRef.current && !detailsRef.current.contains(event.target)) {
                // If it's a click outside, we might NOT want to close details automatically
                // because they might be interacting with something else, but it's often good UX.
                // Let's keep details open until they click save or the close button.
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (initialStatus) {
            setCurrentStatus(initialStatus.status);
            setScore(initialStatus.score);
            setEpisodesWatched(initialStatus.episodes_watched);
            setLocalEpisodes(initialStatus.episodes_watched);
            setListId(initialStatus.id);
            setNotes(initialStatus.notes || '');
            setStartedAt(initialStatus.started_at || '');
            setFinishedAt(initialStatus.finished_at || '');
            setIsRewatching(initialStatus.is_rewatching || false);
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
                    score,
                    episodes_watched: nextEpisodes,
                    notes,
                    started_at: startedAt || null,
                    finished_at: finishedAt || null,
                    is_rewatching: isRewatching
                });
            } else {
                response = await listApi.add({
                    anime_id: animeId,
                    status: newStatus,
                    score,
                    episodes_watched: nextEpisodes,
                    notes,
                    started_at: startedAt || null,
                    finished_at: finishedAt || null,
                    is_rewatching: isRewatching
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
            setScore(0);
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
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-dark-200  text-gray-300 font-bold text-sm sm:text-base border border-dark-50 transition-colors"
                >
                    {isLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <Plus className="w-5 h-5" />
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
            <div className="relative flex items-center justify-between p-1.5 sm:p-2 bg-dark-200  rounded-2xl border border-dark-50   z-10">

                {/* Status Dropdown - Left */}
                <div className="relative flex-shrink-0" ref={dropdownRef}>
                    <button
                        onClick={toggleDropdown}
                        disabled={isLoading}
                        className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all duration-300
                            ${currentOption
                                ? `${currentOption.color} text-white hover:brightness-110`
                                : 'bg-dark-100 text-gray-300 border border-gray-700'}`}
                    >
                        {isLoading ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : currentOption && currentOption.icon ? (
                            <currentOption.icon className="w-4 h-4" />
                        ) : (
                            <div className="w-4 h-4" />
                        )}
                        <span className="hidden sm:inline">{currentOption.label}</span>
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

                {/* Edit Details Button - Right */}
                <div className="flex-shrink-0">
                    <button
                        onClick={toggleDetails}
                        className={`w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition-all duration-300 border
                            ${showDetails || score > 0 || notes || startedAt || isRewatching
                                ? 'bg-accent/20 border-accent/30 text-accent hover:bg-accent hover:text-white hover:border-accent'
                                : 'bg-dark-100 border-gray-700 text-gray-400 hover:border-white/20 hover:text-white hover:bg-white/5'}`}
                        title="Edit Details"
                    >
                        <Edit3 className="w-4 h-4 sm:w-5 sm:h-5" />
                        {score > 0 && !showDetails && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-accent rounded-full border-2 border-dark-200" />
                        )}
                    </button>
                </div>
            </div>

            {/* Progress Bar (Attached below the bar) */}
            <div className="absolute -bottom-1 left-4 right-4 h-1 sm:h-1.5 bg-dark-100 rounded-b-xl overflow-hidden opacity-80 z-0">
                <div
                    style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                    className={`h-full rounded-r-full ${totalEpisodes > 0 && episodesWatched >= totalEpisodes
                        ? 'bg-green-500'
                        : 'bg-accent'
                        }`}
                />
            </div>

            {/* Premium Absolute Detail Popover */}
            {showDetails && (
                <>
                    {/* Invisible backdrop to catch clicks outside the popover */}
                    <div
                        className="fixed inset-0 z-[60]"
                        onClick={closeDetails}
                    />

                    <div
                        ref={detailsRef}
                        className="absolute top-[calc(100%+12px)] right-0 w-[calc(100vw-2rem)] sm:w-[380px] max-w-full bg-dark-100  rounded-3xl border border-dark-50 shadow-none z-[70] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.02]">
                            <h3 className="text-white font-black text-sm uppercase tracking-widest flex items-center gap-2">
                                <Edit3 className="w-4 h-4 text-accent" />
                                Entry Details
                            </h3>
                            <button
                                onClick={closeDetails}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-5 space-y-6">
                            {/* Score Slider / Buttons */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest flex items-center gap-1.5">
                                        <Star className="w-3.5 h-3.5 text-yellow-500" /> Score
                                    </label>
                                    <span className="text-lg font-black text-white">
                                        {score > 0 ? score : '-'} <span className="text-xs text-gray-500 font-bold">/ 10</span>
                                    </span>
                                </div>
                                <div className="flex bg-dark-200 p-1 rounded-2xl border border-white/5 h-11">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                                        <button
                                            key={val}
                                            onClick={() => setScore(score === val ? 0 : val)}
                                            className={`flex-1 flex items-center justify-center transition-all duration-300 rounded-xl
                                                ${val <= score ? 'bg-yellow-500 text-dark-900' : 'hover:bg-white/5 text-gray-500'}`}
                                        >
                                            <span className="font-black text-sm">{val}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Dates Row */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-accent" /> Started
                                    </label>
                                    <input
                                        type="date"
                                        value={startedAt}
                                        onChange={(e) => setStartedAt(e.target.value)}
                                        className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all  [color-scheme:dark]"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest flex items-center gap-1.5">
                                        <Check className="w-3.5 h-3.5 text-green-500" /> Finished
                                    </label>
                                    <input
                                        type="date"
                                        value={finishedAt}
                                        onChange={(e) => setFinishedAt(e.target.value)}
                                        className="w-full bg-dark-200 border border-dark-50 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all  [color-scheme:dark]"
                                    />
                                </div>
                            </div>

                            {/* Rewatching Toggle */}
                            <div className="flex items-center justify-between p-3.5 bg-dark-200/30 border border-white/5 rounded-2xl">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${isRewatching ? 'bg-cyan-500/20' : 'bg-white/5'}`}>
                                        <RotateCcw className={`w-4 h-4 ${isRewatching ? 'text-cyan-400' : 'text-gray-500'}`} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-gray-200">Rewatching</p>
                                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Mark as rewatching</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsRewatching(!isRewatching)}
                                    className={`relative w-12 h-6 rounded-full transition-all duration-300  ${isRewatching ? 'bg-cyan-500' : 'bg-dark-100 border border-gray-700'
                                        }`}
                                >
                                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white  transition-transform duration-300 ease-spring ${isRewatching ? 'translate-x-6' : 'translate-x-0.5'
                                        }`} />
                                </button>
                            </div>

                            {/* Notes */}
                            <div className="space-y-2">
                                <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest flex items-center gap-1.5">
                                    <StickyNote className="w-3.5 h-3.5 text-blue-400" /> Notes
                                </label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Write your private thoughts..."
                                    className="w-full bg-dark-200 border border-dark-50 rounded-2xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all "
                                    rows={3}
                                />
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={closeDetails}
                                    className="flex-1 py-3.5 rounded-xl font-bold text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!listId) return;
                                        setIsLoading(true);
                                        try {
                                            const response = await listApi.update(listId, {
                                                status: currentStatus,
                                                score,
                                                notes,
                                                started_at: startedAt || null,
                                                finished_at: finishedAt || null,
                                                is_rewatching: isRewatching,
                                            });
                                            queryClient.invalidateQueries({ queryKey: ['lists'] });
                                            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
                                            if (onUpdate) onUpdate(response.data);
                                            closeDetails();
                                        } catch (error) {
                                            logger.error('Failed to save details:', error);
                                        } finally {
                                            setIsLoading(false);
                                        }
                                    }}
                                    disabled={isLoading}
                                    className="flex-[2] py-3.5 rounded-xl bg-accent text-white font-bold text-sm hover:brightness-110 transition-all disabled:opacity-50 flex justify-center items-center"
                                >
                                    {isLoading ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        'Save Changes'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
