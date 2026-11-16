import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    Bookmark,
    Check,
    ChevronDown,
    Eye,
    Minus,
    Pause,
    Pencil,
    Plus,
    RotateCcw,
    Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import useListEntryMutation from '../hooks/useListEntryMutation';
import useMediaQuery from '../hooks/useMediaQuery';
import ListEntryEditModal from './ListEntryEditModal';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', color: 'bg-green-500', icon: Eye },
    { value: 'Completed', label: 'Completed', color: 'bg-blue-500', icon: Check },
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
    is_rewatching: false,
    notes: '',
};

const PHONE_QUERY = '(max-width: 639px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const SHEET_CLOSE_MS = 300;
const SHEET_DISMISS_DRAG_PX = 100;

/**
 * The list control on the detail page: a disclosure that opens a status menu (a bottom
 * sheet on phones) plus ±1 progress controls. Every write goes through
 * `useListEntryMutation`, so the server's normaliser decides the resulting status,
 * progress and dates, and failures surface as a toast.
 */
export default function StatusSelector({
    animeId,
    animeSlug,
    animeTitle,
    initialStatus,
    onUpdate,
    totalEpisodes,
    isOwnProfile = true,
    compactSidebar = false,
    showEditInDropdown = true,
    externalEditTrigger = 0,
}) {
    const { isAuthenticated } = useAuth();
    const menuId = useId();
    const containerRef = useRef(null);
    const triggerRef = useRef(null);
    const dragStartY = useRef(null);
    const lastHandledEditTrigger = useRef(externalEditTrigger);
    const closeTimer = useRef(null);

    const isPhone = useMediaQuery(PHONE_QUERY);
    const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);

    const [isOpen, setIsOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [dragOffset, setDragOffset] = useState(0);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const {
        entry,
        setStatus,
        setProgress,
        save,
        remove,
        startRewatch,
        isPending,
    } = useListEntryMutation({
        anime: { id: animeId, slug: animeSlug, episode_count: totalEpisodes },
        entry: initialStatus,
    });

    const currentStatus = entry.status;
    const episodesWatched = entry.episodes_watched || 0;
    const [localEpisodes, setLocalEpisodes] = useState(String(episodesWatched));

    useEffect(() => {
        setLocalEpisodes(String(episodesWatched));
    }, [episodesWatched]);

    useEffect(() => {
        if (externalEditTrigger > lastHandledEditTrigger.current) {
            setIsEditModalOpen(true);
        }
        lastHandledEditTrigger.current = externalEditTrigger;
    }, [externalEditTrigger]);

    useEffect(() => () => clearTimeout(closeTimer.current), []);

    const finishClose = useCallback(() => {
        setIsOpen(false);
        setIsClosing(false);
        setDragOffset(0);
    }, []);

    const closeMenu = useCallback(({ returnFocus = false } = {}) => {
        if (returnFocus) triggerRef.current?.focus();
        if (isPhone && !prefersReducedMotion) {
            setIsClosing(true);
            clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(finishClose, SHEET_CLOSE_MS);
            return;
        }
        finishClose();
    }, [finishClose, isPhone, prefersReducedMotion]);

    const toggleMenu = () => {
        if (isOpen) {
            closeMenu();
            return;
        }
        clearTimeout(closeTimer.current);
        setIsClosing(false);
        setDragOffset(0);
        setIsOpen(true);
    };

    useEffect(() => {
        if (!isOpen) return undefined;
        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                closeMenu();
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [closeMenu, isOpen]);

    if (!isAuthenticated || !isOwnProfile) return null;

    const report = (saved) => {
        if (saved && onUpdate) onUpdate(saved.id ? saved : null);
        return saved;
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Escape' && isOpen) {
            event.stopPropagation();
            closeMenu({ returnFocus: true });
        }
    };

    const handleBlur = (event) => {
        // Focus moved to another element outside the control (Tab, or a click on
        // something focusable): close. A null relatedTarget is a click on nothing
        // focusable, which the pointer handler deals with.
        if (isOpen && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
            closeMenu();
        }
    };

    const handleStatusChange = async (newStatus) => {
        closeMenu({ returnFocus: true });
        report(await setStatus(newStatus));
    };

    const handleRewatch = async () => {
        closeMenu({ returnFocus: true });
        report(await startRewatch());
    };

    const handleRemove = async () => {
        finishClose();
        triggerRef.current?.focus();
        report(await remove());
    };

    const handleEpisodeChange = async (nextEpisodes) => {
        if (!entry.id || isPending) return;
        if (!Number.isInteger(nextEpisodes) || nextEpisodes < 0 || nextEpisodes === episodesWatched) {
            setLocalEpisodes(String(episodesWatched));
            return;
        }
        report(await setProgress(nextEpisodes));
    };

    const handleOpenEditModal = () => {
        finishClose();
        setIsEditModalOpen(true);
    };

    const handleSaveDetailedEntry = async (payload) => {
        const saved = report(await save(payload));
        if (saved) setIsEditModalOpen(false);
        return saved;
    };

    const handleTouchStart = (event) => {
        if (!isPhone) return;
        dragStartY.current = event.touches[0].clientY;
    };

    const handleTouchMove = (event) => {
        if (!isPhone || dragStartY.current === null) return;
        const delta = event.touches[0].clientY - dragStartY.current;
        if (delta > 0) setDragOffset(delta);
    };

    const handleTouchEnd = () => {
        if (!isPhone) return;
        if (dragOffset > SHEET_DISMISS_DRAG_PX) {
            closeMenu();
        } else {
            setDragOffset(0);
        }
        dragStartY.current = null;
    };

    const currentOption = STATUS_OPTIONS.find((option) => option.value === currentStatus);
    const progressPercentage = totalEpisodes ? Math.round((episodesWatched / totalEpisodes) * 100) : 0;
    const isFullyWatched = totalEpisodes > 0 && episodesWatched >= totalEpisodes;
    const canRewatch = currentStatus === 'Completed' && !entry.is_rewatching;
    const animate = !prefersReducedMotion;
    const iconBox = isPhone ? 'w-10 h-10' : 'w-8 h-8';

    const modalEntry = currentStatus || entry.id
        ? { ...DEFAULT_MODAL_ENTRY, ...entry }
        : DEFAULT_MODAL_ENTRY;

    const triggerProps = {
        ref: triggerRef,
        type: 'button',
        onClick: toggleMenu,
        disabled: isPending,
        'aria-expanded': isOpen,
        'aria-controls': menuId,
    };

    const renderMenu = () => {
        if (!isOpen) return null;

        const sheetMotion = animate
            ? (isClosing ? 'animate-out slide-out-to-bottom' : 'animate-in slide-in-from-bottom')
            : '';

        return (
            <>
                <div
                    className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-[99] sm:hidden ${animate ? (isClosing ? 'animate-out fade-out' : 'animate-fade-in') : ''}`}
                    onClick={() => closeMenu()}
                    aria-hidden="true"
                />

                <div
                    id={menuId}
                    className={isPhone
                        ? `fixed bottom-0 left-0 right-0 z-[100] p-4 pb-10 bg-dark-100 rounded-t-[32px] border-t border-white/10 ${sheetMotion}`
                        : `absolute top-full left-0 mt-3 p-2 bg-dark-100 rounded-2xl shadow-none z-[100] ${compactSidebar ? 'w-full min-w-[220px]' : 'w-56 border border-dark-50'}`}
                    style={isPhone ? {
                        transform: `translateY(${dragOffset}px)`,
                        transition: dragStartY.current || !animate ? 'none' : 'transform 0.2s ease-out',
                    } : undefined}
                >
                    {isPhone && (
                        <div
                            className="w-12 h-1.5 bg-gray-800/80 rounded-full mx-auto mb-6 cursor-grab active:cursor-grabbing"
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            aria-hidden="true"
                        />
                    )}

                    {STATUS_OPTIONS.map((option) => {
                        const isCurrent = currentStatus === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => handleStatusChange(option.value)}
                                aria-pressed={isCurrent}
                                className={`w-full px-4 py-3.5 sm:px-3 sm:py-2.5 text-left flex items-center gap-4 sm:gap-3 transition-colors duration-200 motion-reduce:transition-none group rounded-xl sm:rounded-lg ${isCurrent ? 'bg-white/10' : 'hover:bg-white/5'}`}
                            >
                                <div className={`${iconBox} shrink-0 flex items-center justify-center rounded-xl sm:rounded-lg ${option.color} bg-opacity-20 group-hover:bg-opacity-100 transition-colors duration-300 motion-reduce:transition-none`}>
                                    <option.icon
                                        aria-hidden="true"
                                        className={`w-5 h-5 sm:w-4 sm:h-4 ${option.color.replace('bg-', 'text-')} group-hover:text-white`}
                                    />
                                </div>
                                <span className={`font-bold text-base sm:text-sm leading-tight whitespace-nowrap transition-colors ${isCurrent ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                                    {option.label}
                                </span>
                            </button>
                        );
                    })}

                    <div className="h-px bg-white/10 my-2 sm:my-1" />

                    {canRewatch ? (
                        <MenuAction icon={RotateCcw} iconBox={iconBox} onClick={handleRewatch}>
                            Rewatch
                        </MenuAction>
                    ) : null}

                    {currentStatus ? (
                        <button
                            type="button"
                            onClick={handleRemove}
                            className="w-full px-4 py-3.5 sm:px-3 sm:py-2.5 text-left text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-4 sm:gap-3 text-base sm:text-sm font-bold rounded-xl sm:rounded-lg transition-colors duration-200 group"
                        >
                            <div className={`${iconBox} flex items-center justify-center rounded-xl sm:rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors`}>
                                <Trash2 aria-hidden="true" className="w-5 h-5 sm:w-4 sm:h-4" />
                            </div>
                            Remove from List
                        </button>
                    ) : null}

                    {showEditInDropdown ? (
                        <MenuAction icon={Pencil} iconBox={iconBox} onClick={handleOpenEditModal}>
                            Edit
                        </MenuAction>
                    ) : null}
                </div>
            </>
        );
    };

    const editModal = (
        <ListEntryEditModal
            isOpen={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            onSave={handleSaveDetailedEntry}
            initialEntry={modalEntry}
            totalEpisodes={totalEpisodes}
            statusOptions={STATUS_OPTIONS}
            isSaving={isPending}
            animeTitle={animeTitle}
        />
    );

    const spinner = (size) => (
        <div className={`${size} border-2 border-white/30 border-t-white rounded-full animate-spin motion-reduce:animate-none`} />
    );

    if (!currentStatus) {
        return (
            <>
                <div
                    className="relative w-full"
                    ref={containerRef}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                >
                    <button
                        {...triggerProps}
                        className={`w-full flex items-center justify-center gap-2 px-3 transition-colors duration-300 font-bold text-sm ${compactSidebar
                            ? 'h-9 rounded-lg bg-dark-100 text-gray-400 hover:text-white whitespace-nowrap'
                            : 'px-6 py-3 rounded-xl bg-dark-200 text-gray-300 border border-dark-50'}`}
                    >
                        {isPending ? spinner('w-5 h-5') : <Plus aria-hidden="true" className="w-4 h-4 sm:w-5 sm:h-5" />}
                        Add to List
                        <ChevronDown aria-hidden="true" className={`w-4 h-4 ml-1 transition-transform duration-300 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {renderMenu()}
                </div>
                {editModal}
            </>
        );
    }

    return (
        <>
            <div className="w-full relative status-selector-container">
                <div className={`relative flex items-center justify-between z-10 ${compactSidebar ? 'p-0 bg-transparent border-none' : 'p-1.5 sm:p-2 bg-dark-200 rounded-2xl border border-dark-50'}`}>
                    <div
                        className={compactSidebar ? 'relative flex-1 min-w-0' : 'relative flex-shrink-0'}
                        ref={containerRef}
                        onKeyDown={handleKeyDown}
                        onBlur={handleBlur}
                    >
                        <button
                            {...triggerProps}
                            aria-label={`List status: ${currentOption?.label ?? currentStatus}`}
                            className={`flex items-center justify-center gap-2 px-3 rounded-lg font-bold text-xs sm:text-sm transition-colors duration-300 w-full ${compactSidebar ? 'h-9' : 'py-2.5 border'} ${currentOption
                                ? `${compactSidebar
                                    ? 'text-white hover:brightness-110'
                                    : `${currentOption.color} text-white hover:brightness-110 border-transparent`}`
                                : 'bg-dark-100 text-gray-400 border-gray-700 hover:border-gray-600'}`}
                            style={compactSidebar && currentOption ? {
                                backgroundColor: 'var(--anime-accent, var(--color-accent))',
                            } : undefined}
                        >
                            {isPending ? (
                                spinner('w-4 h-4')
                            ) : !compactSidebar && currentOption?.icon ? (
                                <currentOption.icon aria-hidden="true" className="w-4 h-4" />
                            ) : (
                                <div className={`${compactSidebar ? 'hidden' : 'w-4 h-4'}`} />
                            )}
                            <span className={compactSidebar ? 'inline' : 'hidden sm:inline'}>{currentOption?.label}</span>
                            <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 ml-0.5 transition-transform duration-300 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {renderMenu()}
                    </div>

                    {!compactSidebar && (
                        <div className="flex items-center justify-center flex-1 px-2 sm:px-4 min-w-[120px]">
                            <div className="flex items-center gap-2 sm:gap-3 bg-dark-100/50 rounded-xl p-1 border border-white/5">
                                <button
                                    type="button"
                                    onClick={() => handleEpisodeChange(episodesWatched - 1)}
                                    disabled={isPending || episodesWatched <= 0}
                                    aria-label="Decrease episodes watched"
                                    className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-dark-200 hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-dark-200 flex-shrink-0"
                                >
                                    <Minus aria-hidden="true" className="w-4 h-4" />
                                </button>

                                <div className="flex items-baseline gap-0.5 px-1 min-w-[50px] sm:min-w-[70px] justify-center">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        aria-label="Episodes watched"
                                        value={localEpisodes}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            if (nextValue === '' || /^\d+$/.test(nextValue)) {
                                                setLocalEpisodes(nextValue);
                                            }
                                        }}
                                        onBlur={() => {
                                            const nextValue = localEpisodes === '' ? 0 : Number.parseInt(localEpisodes, 10);
                                            handleEpisodeChange(nextValue);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') event.currentTarget.blur();
                                        }}
                                        className="w-9 sm:w-11 bg-transparent text-white font-black text-base sm:text-lg tabular-nums tracking-tight text-center focus:outline-none focus:bg-white/5 rounded-lg transition-colors"
                                    />
                                    <span className="text-gray-500 text-xs sm:text-sm font-bold" aria-hidden="true">/</span>
                                    <span className="text-gray-400 text-xs sm:text-sm font-bold tabular-nums">
                                        <span className="sr-only">of </span>{totalEpisodes || '?'}
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleEpisodeChange(episodesWatched + 1)}
                                    disabled={isPending || isFullyWatched}
                                    aria-label="Increase episodes watched"
                                    className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-accent/20 hover:bg-accent-dark text-accent hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-accent/20 disabled:hover:text-accent flex-shrink-0"
                                >
                                    <Plus aria-hidden="true" className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className={`mt-1.5 w-full flex items-center gap-2 ${compactSidebar ? '' : 'hidden'}`}>
                    <div className="flex-1 h-1 bg-dark-100/50 rounded-full overflow-hidden border border-white/5">
                        <div
                            style={{ width: `${Math.min(progressPercentage, 100)}%` }}
                            className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${isFullyWatched ? 'bg-green-500' : 'bg-accent-dark'}`}
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
                            className={`h-full rounded-r-full ${isFullyWatched ? 'bg-green-500' : 'bg-accent-dark'}`}
                        />
                    </div>
                )}
            </div>
            {editModal}
        </>
    );
}

function MenuAction({ icon: Icon, iconBox, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full px-4 py-3.5 sm:px-3 sm:py-2.5 text-left text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-4 sm:gap-3 text-base sm:text-sm font-bold rounded-xl sm:rounded-lg transition-colors duration-200 group"
        >
            <div className={`${iconBox} flex items-center justify-center rounded-xl sm:rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors`}>
                <Icon aria-hidden="true" className="w-5 h-5 sm:w-4 sm:h-4" />
            </div>
            {children}
        </button>
    );
}
