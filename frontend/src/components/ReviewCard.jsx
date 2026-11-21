import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Star, AlertTriangle, Eye, EyeOff, MoreVertical, Edit2, Trash2, Check, Book, Film, Music, Users, ThumbsUp, ThumbsDown, Flag, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewApi } from '../api/client';
import MiniProfileHoverCard from './common/MiniProfileHoverCard';
import AnimeMediaImage from './common/AnimeMediaImage';
import Spoiler from './common/Spoiler';
import CustomSelect from './common/CustomSelect';
import {
    applyReviewReaction,
    applyReviewVote,
    getReviewErrorMessage,
    patchCachedReview,
    pickReviewCounts,
    REVIEW_REPORT_REASONS,
} from '../api/queries/reviews';

// Generate consistent color from string
const stringToColor = (str) => {
    if (!str) return '#6b7280';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
        '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
        '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
        '#636c8a', '#75698d', '#8b7ca1', '#a07e97', '#bc7d95'
    ];
    return colors[Math.abs(hash) % colors.length];
};

// Letter Avatar component
const LetterAvatar = ({ name, size = 'md' }) => {
    const letter = (name || '?')[0].toUpperCase();
    const bgColor = stringToColor(name);
    const sizeClasses = {
        sm: 'w-8 h-8 text-sm',
        md: 'w-10 h-10 text-base',
        lg: 'w-12 h-12 text-lg'
    };

    return (
        <div
            className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-white `}
            style={{ backgroundColor: bgColor }}
        >
            {letter}
        </div>
    );
};

// Custom parser for spoilers and plain text
const renderText = (text) => {
    if (!text) return null;

    // Review text is stored as typed; React escapes it on render.
    const parts = text.split(/(>![\s\S]*?!<)/g);

    return parts.map((part, i) => {
        if (part.startsWith('>!') && part.endsWith('!<')) {
            const content = part.slice(2, -2);
            return (
                <Spoiler key={i}>
                    <span className="whitespace-pre-wrap">{content}</span>
                </Spoiler>
            );
        }
        return <span key={i} className="whitespace-pre-wrap">{part}</span>;
    });
};

// Scorecard sub-rating row for the dedicated box
const ScoreRow = ({ icon: Icon, label, value, accentColor }) => {
    if (!value) return null;
    const displayValue = (value / 2).toFixed(1);
    const percentage = (value / 2 / 5) * 100;

    return (
        <div className="flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <span className="text-[10px] text-gray-500 w-16 truncate">{label}</span>
            <div className="flex-1 h-1.5 bg-gray-800/80 rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full"
                    style={{
                        width: `${percentage}%`,
                        backgroundColor: accentColor || '#75698d'
                    }}
                />
            </div>
            <span className="text-[11px] text-gray-400 font-medium tabular-nums">{displayValue}</span>
        </div>
    );
};

const REVIEW_TEXT_COLLAPSE_LENGTH = 420;
const DEFAULT_REACTIONS = [
    { type: 'thumbs_up', emoji: '👍', count: 0, active: false, label: 'Thumbs up' },
    { type: 'heart', emoji: '❤️', count: 0, active: false, label: 'Heart' },
    { type: 'laugh', emoji: '😂', count: 0, active: false, label: 'Laugh' },
    { type: 'surprised', emoji: '😮', count: 0, active: false, label: 'Surprised' },
    { type: 'sad', emoji: '😢', count: 0, active: false, label: 'Sad' },
];

const REPORT_NOTE_MAX_LENGTH = 500;
const FOCUSABLE_SELECTOR = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Small modal for reporting someone else's review (reason + optional note). */
function ReviewReportDialog({ reviewId, onClose }) {
    const titleId = useId();
    const reasonId = useId();
    const noteId = useId();
    const panelRef = useRef(null);
    const doneRef = useRef(null);
    const [reason, setReason] = useState('');
    const [description, setDescription] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const reportMutation = useMutation({
        mutationFn: () => reviewApi.report(reviewId, { reason, description: description.trim() }),
        onSuccess: (response) => {
            setError('');
            setResult(response?.data?.created === false ? 'existing' : 'created');
        },
        onError: (err) => setError(getReviewErrorMessage(err, "Couldn't send the report. Please try again.")),
    });

    useEffect(() => {
        if (result) {
            doneRef.current?.focus();
        } else {
            document.getElementById(reasonId)?.focus();
        }
    }, [result, reasonId]);

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            // An open reason list closes itself first.
            const target = event.target;
            if (target?.getAttribute?.('aria-haspopup') === 'listbox' && target.getAttribute('aria-expanded') === 'true') return;
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab' || !panelRef.current) return;
        const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (!reason || reportMutation.isPending) return;
        reportMutation.mutate();
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
            onKeyDown={handleKeyDown}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-sm rounded-2xl border border-gray-800 bg-dark-100 shadow-xl"
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <h2 id={titleId} className="text-sm font-bold text-white">Report review</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-4 h-4 text-gray-400" />
                    </button>
                </div>

                {result ? (
                    <div className="p-4 space-y-4">
                        <p className="text-sm text-gray-300" role="status">
                            {result === 'existing' ? "You've already reported this review." : "Thanks, we'll take a look."}
                        </p>
                        <div className="flex justify-end">
                            <button ref={doneRef} type="button" onClick={onClose} className="btn-secondary text-sm px-4 py-2">
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-4 space-y-4">
                        <div>
                            <label htmlFor={reasonId} className="block text-xs font-bold text-gray-500 mb-2">
                                Reason
                            </label>
                            <CustomSelect
                                id={reasonId}
                                value={reason}
                                onChange={setReason}
                                options={REVIEW_REPORT_REASONS}
                                placeholder="Choose a reason"
                                triggerClassName="bg-dark-50 border-gray-700 rounded-lg px-3 py-2 text-sm font-normal"
                            />
                        </div>
                        <div>
                            <label htmlFor={noteId} className="block text-xs font-bold text-gray-500 mb-2">
                                Note (optional)
                            </label>
                            <textarea
                                id={noteId}
                                value={description}
                                onChange={(event) => setDescription(event.target.value.slice(0, REPORT_NOTE_MAX_LENGTH))}
                                maxLength={REPORT_NOTE_MAX_LENGTH}
                                rows={3}
                                placeholder="Anything the moderators should know?"
                                className="input w-full resize-y text-sm"
                            />
                            <div className="mt-1 px-1 text-right text-[10px] font-medium text-gray-500">
                                {description.length} / {REPORT_NOTE_MAX_LENGTH}
                            </div>
                        </div>
                        {error && (
                            <p className="text-xs text-red-400" role="alert">{error}</p>
                        )}
                        <div className="flex items-center justify-end gap-3">
                            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!reason || reportMutation.isPending}
                                className="btn-primary text-sm px-4 py-2"
                            >
                                {reportMutation.isPending ? 'Sending...' : 'Report'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>,
        document.body
    );
}

export default function ReviewCard({ review, onEdit, onDelete, showAnime = false, forceHideSpoilers = false, compact = false, accentColor = null }) {
    const { user, isAuthenticated } = useAuth();
    const [showSpoilers, setShowSpoilers] = useState(!review.has_spoilers && !forceHideSpoilers);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const queryClient = useQueryClient();
    const menuId = useId();
    const menuContainerRef = useRef(null);
    const menuTriggerRef = useRef(null);
    const menuRef = useRef(null);

    const isOwner = Boolean(user?.username) && user.username === review.user?.username;
    const canManage = isOwner && Boolean(onDelete || onEdit);
    const canReport = isAuthenticated && !isOwner;
    const hasMenu = canManage || canReport;
    const hasText = review.text && review.text.trim().length > 0;
    const hasSubRatings = review.rating_story || review.rating_animation || review.rating_music || review.rating_characters;
    const shouldShowReadMore = hasText && (
        review.text.trim().length > REVIEW_TEXT_COLLAPSE_LENGTH
        || review.text.split(/\r?\n/).length > 5
    );
    const userVotes = review.user_votes || { helpful: false, dislike: false };
    const reactionSummary = Array.isArray(review.reactions) && review.reactions.length > 0
        ? review.reactions
        : DEFAULT_REACTIONS;

    // Votes and reactions patch this review in the cached lists (optimistic),
    // reconcile with the counts the response carries, and put the previous
    // fields back on error. No list is refetched.
    const voteMutation = useMutation({
        mutationFn: (voteType) => reviewApi.vote(review.id, voteType),
        onMutate: (voteType) => {
            const previous = {
                helpful_count: review.helpful_count || 0,
                dislike_count: review.dislike_count || 0,
                user_votes: userVotes,
            };
            patchCachedReview(queryClient, review.id, (cached) => applyReviewVote(cached, voteType));
            return { previous };
        },
        onSuccess: (response) => {
            const fresh = pickReviewCounts(response?.data);
            if (fresh) patchCachedReview(queryClient, review.id, fresh);
        },
        onError: (err, _voteType, context) => {
            if (context?.previous) patchCachedReview(queryClient, review.id, context.previous);
            toast.error(getReviewErrorMessage(err, "Couldn't save your vote."));
        },
    });

    const reactionMutation = useMutation({
        mutationFn: (reactionType) => reviewApi.react(review.id, reactionType),
        onMutate: (reactionType) => {
            const previous = { reactions: review.reactions || [] };
            patchCachedReview(queryClient, review.id, (cached) => ({
                reactions: applyReviewReaction(
                    Array.isArray(cached.reactions) && cached.reactions.length > 0 ? cached.reactions : DEFAULT_REACTIONS,
                    reactionType
                ),
            }));
            return { previous };
        },
        onSuccess: (response) => {
            const fresh = pickReviewCounts(response?.data);
            if (fresh) patchCachedReview(queryClient, review.id, fresh);
        },
        onError: (err, _reactionType, context) => {
            if (context?.previous) patchCachedReview(queryClient, review.id, context.previous);
            toast.error(getReviewErrorMessage(err, "Couldn't save your reaction."));
        },
    });

    const handleVote = (voteType) => {
        if (!isAuthenticated || isOwner || voteMutation.isPending) return;
        voteMutation.mutate(voteType);
    };

    const helpfulCount = review.helpful_count || 0;
    const dislikeCount = review.dislike_count || 0;

    const handleReaction = (reactionType) => {
        if (!isAuthenticated || isOwner || reactionMutation.isPending) return;
        reactionMutation.mutate(reactionType);
    };

    const closeMenu = ({ returnFocus = false } = {}) => {
        setIsMenuOpen(false);
        if (returnFocus) menuTriggerRef.current?.focus();
    };

    useEffect(() => {
        if (!isMenuOpen) return undefined;
        menuRef.current?.querySelector('[role="menuitem"]')?.focus();

        const onPointerDown = (event) => {
            if (!menuContainerRef.current?.contains(event.target)) setIsMenuOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsMenuOpen(false);
                menuTriggerRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isMenuOpen]);

    const handleMenuKeyDown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
        if (items.length === 0) return;
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next].focus();
    };

    const handleDelete = () => {
        closeMenu();
        if (window.confirm("Delete this review? This can't be undone.")) {
            onDelete(review.id);
        } else {
            menuTriggerRef.current?.focus();
        }
    };

    const handleCloseReport = () => {
        setIsReportOpen(false);
        menuTriggerRef.current?.focus();
    };

    const reactionLabel = (reaction) => reaction.label
        || DEFAULT_REACTIONS.find((item) => item.type === reaction.type)?.label
        || reaction.type;

    // Compact mode for rating-only reviews
    if (compact || (!hasText && !showAnime)) {
        return (
            <div className="bg-dark-100/50 rounded-lg px-4 py-3 border border-gray-800/50 flex items-center gap-3">
                <MiniProfileHoverCard user={review.user}>
                    <Link to={`/u/${review.user?.username}`} className="shrink-0">
                        {review.user?.avatar ? (
                            <img src={review.user.avatar} alt={review.user.username} className="w-8 h-8 rounded-full object-cover border border-gray-700" />
                        ) : (
                            <LetterAvatar name={review.user?.username} size="sm" />
                        )}
                    </Link>
                </MiniProfileHoverCard>
                <Link to={`/u/${review.user?.username}`} className="text-sm text-gray-400 hover:text-white transition-colors font-medium truncate">
                    {review.user?.username}
                </Link>
                <div className="flex items-center gap-0.5 ml-auto">
                    {[1, 2, 3, 4, 5].map((starIndex) => {
                        const value = starIndex * 2;
                        const rating = review.rating || 0;
                        const isFull = rating >= value;
                        const isHalf = rating === value - 1;
                        return (
                            <div key={starIndex} className="relative">
                                <Star className={`w-3 h-3 ${isFull ? 'fill-yellow-500 text-yellow-500' : 'text-gray-700'}`} />
                                {isHalf && (
                                    <div className="absolute inset-0 overflow-hidden w-[50%]">
                                        <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <span className="text-[10px] text-gray-500 shrink-0">
                    {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                </span>
            </div>
        );
    }

    const renderContent = (text) => {
        if (!text || !text.trim()) return <p className="text-gray-500 text-sm italic">No text review provided.</p>;
        return (
            <div className={`text-sm text-white leading-relaxed ${isExpanded ? '' : 'line-clamp-6'}`}>
                {renderText(text)}
            </div>
        );
    };

    return (
        <div className="bg-dark-100 rounded-xl border border-gray-800 animate-fade-in mb-3 overflow-visible">
            <div className="flex items-start">
                {/* Left Column: Main Content */}
                <div className="flex-1 p-4 min-w-0">
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                        <div className={`shrink-0 ${showAnime ? 'w-10 h-14 overflow-hidden rounded-md border border-gray-700' : 'overflow-visible'}`}>
                            {showAnime ? (
                                <Link to={`/anime/${review.anime?.slug}`} className="block w-full h-full">
                                    {review.anime ? (
                                        <AnimeMediaImage
                                            anime={review.anime}
                                            kind="cover"
                                            size="small"
                                            alt={review.anime.title}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-dark-50" />
                                    )}
                                </Link>
                            ) : (
                                <MiniProfileHoverCard user={review.user}>
                                    <Link to={`/u/${review.user?.username}`} className="block">
                                        {review.user?.avatar ? (
                                            <img src={review.user.avatar} alt={review.user.username} className="w-9 h-9 rounded-full object-cover border border-gray-700" />
                                        ) : (
                                            <LetterAvatar name={review.user?.username} size="md" />
                                        )}
                                    </Link>
                                </MiniProfileHoverCard>
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                {showAnime ? (
                                    <Link to={`/anime/${review.anime?.slug}`} className="font-semibold text-white text-sm line-clamp-1 hover:text-accent transition-colors">
                                        {review.anime?.title}
                                    </Link>
                                ) : (
                                    <Link to={`/u/${review.user?.username}`} className="font-medium text-white text-sm hover:text-accent transition-colors">
                                        {review.user?.username}
                                    </Link>
                                )}
                                <span className="text-[10px] text-gray-500">
                                    {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                                </span>
                                {review.is_completed && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-500/10 text-green-400">
                                        <Check className="w-2.5 h-2.5 mr-0.5" />
                                        Completed
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-1 mt-1 text-yellow-500">
                                {[1, 2, 3, 4, 5].map((starIndex) => {
                                    const value = starIndex * 2;
                                    const rating = review.rating || 0;
                                    const isFull = rating >= value;
                                    const isHalf = rating === value - 1;
                                    return (
                                        <div key={starIndex} className="relative">
                                            <Star className={`w-3.5 h-3.5 ${isFull ? 'fill-current' : 'text-gray-700'}`} />
                                            {isHalf && (
                                                <div className="absolute inset-0 overflow-hidden w-[50%]">
                                                    <Star className="w-3.5 h-3.5 fill-current" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                <span className="text-xs text-yellow-500/80 ml-1 font-bold">{(review.rating || 0) / 2}</span>
                            </div>
                        </div>

                        {/* Options: edit/delete for the owner, report for everyone else */}
                        {hasMenu && (
                            <div ref={menuContainerRef} className="relative shrink-0">
                                <button
                                    ref={menuTriggerRef}
                                    type="button"
                                    onClick={() => setIsMenuOpen((open) => !open)}
                                    aria-label="Review options"
                                    aria-haspopup="menu"
                                    aria-expanded={isMenuOpen}
                                    aria-controls={isMenuOpen ? menuId : undefined}
                                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    <MoreVertical className="w-4 h-4" />
                                </button>

                                {isMenuOpen && (
                                    <div
                                        ref={menuRef}
                                        id={menuId}
                                        role="menu"
                                        aria-label="Review options"
                                        onKeyDown={handleMenuKeyDown}
                                        className="absolute right-0 top-full mt-1 w-28 bg-dark-200 rounded-lg border border-gray-700  z-20 overflow-hidden"
                                    >
                                        {canManage && onEdit && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => { closeMenu(); onEdit(review); }}
                                                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
                                            >
                                                <Edit2 className="w-3 h-3" /> Edit
                                            </button>
                                        )}
                                        {canManage && onDelete && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={handleDelete}
                                                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2"
                                            >
                                                <Trash2 className="w-3 h-3" /> Delete
                                            </button>
                                        )}
                                        {canReport && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => { closeMenu(); setIsReportOpen(true); }}
                                                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
                                            >
                                                <Flag className="w-3 h-3" /> Report
                                            </button>
                                        )}
                                    </div>
                                )}

                                {isReportOpen && (
                                    <ReviewReportDialog reviewId={review.id} onClose={handleCloseReport} />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Review Text */}
                    <div className="relative mt-4">
                        {review.has_spoilers && !showSpoilers ? (
                            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 flex flex-col items-center justify-center text-center gap-2 min-h-[60px]">
                                <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span>Contains Spoilers</span>
                                </div>
                                <button
                                    onClick={() => setShowSpoilers(true)}
                                    className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1 rounded-full transition-colors flex items-center gap-1"
                                >
                                    <Eye className="w-3 h-3" /> Show
                                </button>
                            </div>
                        ) : (
                            <div>
                                {renderContent(review.text)}

                                {shouldShowReadMore && (
                                    <button
                                        onClick={() => setIsExpanded((current) => !current)}
                                        className="mt-3 text-[11px] font-medium text-gray-400 hover:text-white transition-colors"
                                    >
                                        {isExpanded ? 'Show less' : 'Read more'}
                                    </button>
                                )}

                                {review.has_spoilers && (
                                    <button
                                        onClick={() => setShowSpoilers(false)}
                                        className="mt-2 text-[10px] text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors"
                                    >
                                        <EyeOff className="w-3 h-3" /> Hide
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Mobile sub-ratings */}
                    {hasSubRatings && (
                        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-800/50 lg:hidden">
                            {review.rating_story && (
                                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                    <Book className="w-3 h-3" /> {(review.rating_story / 2).toFixed(1)}
                                </div>
                            )}
                            {review.rating_animation && (
                                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                    <Film className="w-3 h-3" /> {(review.rating_animation / 2).toFixed(1)}
                                </div>
                            )}
                            {review.rating_music && (
                                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                    <Music className="w-3 h-3" /> {(review.rating_music / 2).toFixed(1)}
                                </div>
                            )}
                            {review.rating_characters && (
                                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                    <Users className="w-3 h-3" /> {(review.rating_characters / 2).toFixed(1)}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="mt-3 pt-3 border-t border-gray-800/30 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={() => handleVote('helpful')}
                                disabled={!isAuthenticated || isOwner || voteMutation.isPending}
                                aria-pressed={Boolean(userVotes.helpful)}
                                className={`flex items-center gap-1.5 text-[11px] transition-all rounded-full px-2.5 py-1 ${userVotes.helpful
                                    ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                                    : 'text-gray-500 hover:text-gray-300 border border-gray-800/60 hover:border-gray-700'
                                    } ${(!isAuthenticated || isOwner) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                title={!isAuthenticated ? 'Login to vote' : isOwner ? 'Cannot vote on your own review' : 'Mark as helpful'}
                            >
                                <ThumbsUp className={`w-3 h-3 ${userVotes.helpful ? 'fill-green-400' : ''}`} />
                                <span>Helpful</span>
                                <span>({helpfulCount})</span>
                            </button>

                            <button
                                onClick={() => handleVote('dislike')}
                                disabled={!isAuthenticated || isOwner || voteMutation.isPending}
                                aria-pressed={Boolean(userVotes.dislike)}
                                className={`flex items-center gap-1.5 text-[11px] transition-all rounded-full px-2.5 py-1 ${userVotes.dislike
                                    ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                                    : 'text-gray-500 hover:text-gray-300 border border-gray-800/60 hover:border-gray-700'
                                    } ${(!isAuthenticated || isOwner) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                title={!isAuthenticated ? 'Login to vote' : isOwner ? 'Cannot vote on your own review' : 'Mark as disliked'}
                            >
                                <ThumbsDown className={`w-3 h-3 ${userVotes.dislike ? 'fill-red-400' : ''}`} />
                                <span>Dislike</span>
                                <span>({dislikeCount})</span>
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {reactionSummary.map((reaction) => (
                                <button
                                    key={reaction.type}
                                    onClick={() => handleReaction(reaction.type)}
                                    disabled={!isAuthenticated || isOwner || reactionMutation.isPending}
                                    aria-label={`${reactionLabel(reaction)} (${reaction.count || 0})`}
                                    aria-pressed={Boolean(reaction.active)}
                                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${reaction.active
                                        ? 'border-accent/40 bg-accent/10 text-white'
                                        : 'border-gray-800/60 bg-dark-50/60 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                                        } ${(!isAuthenticated || isOwner) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                    title={!isAuthenticated ? 'Login to react' : isOwner ? 'Cannot react to your own review' : reactionLabel(reaction)}
                                >
                                    <span className="text-sm leading-none">{reaction.emoji}</span>
                                    <span>{reaction.count || 0}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Column: Scorecard (desktop only) */}
                {hasSubRatings && (
                    <div className="hidden lg:flex w-44 shrink-0 bg-dark-50/50 border-l border-gray-800/50 p-4 flex-col gap-4">
                        <ScoreRow icon={Book} label="Story" value={review.rating_story} accentColor={accentColor} />
                        <ScoreRow icon={Film} label="Animation" value={review.rating_animation} accentColor={accentColor} />
                        <ScoreRow icon={Music} label="Music" value={review.rating_music} accentColor={accentColor} />
                        <ScoreRow icon={Users} label="Characters" value={review.rating_characters} accentColor={accentColor} />
                    </div>
                )}
            </div>
        </div>
    );
}
