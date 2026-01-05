import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, User, AlertTriangle, Eye, EyeOff, MoreVertical, Edit2, Trash2, Check, Book, Film, Music, Users, ThumbsUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewApi } from '../api/client';

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
        '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
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
            className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-white shadow-lg`}
            style={{ backgroundColor: bgColor }}
        >
            {letter}
        </div>
    );
};

// Helper for inline spoilers
const Spoiler = ({ children }) => {
    const [revealed, setRevealed] = useState(false);
    return (
        <span
            onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); }}
            className={`cursor-pointer transition-all duration-200 rounded px-1 inline-block align-baseline
                ${revealed
                    ? 'bg-red-500/10 text-red-100'
                    : 'bg-gray-800 text-transparent select-none hover:bg-gray-700'
                }`}
            title="Click to toggle spoiler"
        >
            {children}
        </span>
    );
};

// Custom parser for spoilers and plain text
const renderText = (text) => {
    if (!text) return null;

    const decodedText = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const parts = decodedText.split(/(>![\s\S]*?!<)/g);

    return parts.map((part, i) => {
        if (part.startsWith('>!') && part.endsWith('!<')) {
            const content = part.slice(2, -2);
            return <Spoiler key={i}>{content}</Spoiler>;
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
                        backgroundColor: accentColor || '#8b5cf6'
                    }}
                />
            </div>
            <span className="text-[11px] text-gray-400 font-medium tabular-nums">{displayValue}</span>
        </div>
    );
};

export default function ReviewCard({ review, onEdit, onDelete, showAnime = false, forceHideSpoilers = false, compact = false, accentColor = null }) {
    const { user, isAuthenticated } = useAuth();
    const [showSpoilers, setShowSpoilers] = useState(!review.has_spoilers && !forceHideSpoilers);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const queryClient = useQueryClient();

    const isOwner = user?.username === review.user?.username;
    const hasText = review.text && review.text.trim().length > 0;
    const hasSubRatings = review.rating_story || review.rating_animation || review.rating_music || review.rating_characters;

    // Vote mutation
    const voteMutation = useMutation({
        mutationFn: () => reviewApi.vote(review.id, true),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
        }
    });

    const handleVote = () => {
        if (!isAuthenticated || isOwner) return;
        voteMutation.mutate();
    };

    const hasVoted = review.user_vote === true;
    const helpfulCount = review.helpful_count || 0;

    // Compact mode for rating-only reviews
    if (compact || (!hasText && !showAnime)) {
        return (
            <div className="bg-dark-100/50 rounded-lg px-4 py-3 border border-gray-800/50 flex items-center gap-3">
                <Link to={`/profile/${review.user?.username}`} className="shrink-0">
                    {review.user?.avatar ? (
                        <img src={review.user.avatar} alt={review.user.username} className="w-8 h-8 rounded-full object-cover border border-gray-700" />
                    ) : (
                        <LetterAvatar name={review.user?.username} size="sm" />
                    )}
                </Link>
                <Link to={`/profile/${review.user?.username}`} className="text-sm text-gray-400 hover:text-white transition-colors font-medium truncate">
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
                <span className="text-[10px] text-gray-600 shrink-0">
                    {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                </span>
            </div>
        );
    }

    const renderContent = (text) => {
        if (!text || !text.trim()) return <p className="text-gray-500 text-sm italic">No text review provided.</p>;
        return (
            <div className="text-white leading-relaxed">
                {renderText(text)}
            </div>
        );
    };

    return (
        <div className="bg-dark-100 rounded-xl border border-gray-800 animate-fade-in mb-3 overflow-hidden">
            <div className="flex">
                {/* Left Column: Main Content */}
                <div className="flex-1 p-4 min-w-0">
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                        <div className={`overflow-hidden shrink-0 ${showAnime ? 'w-10 h-14 rounded-md border border-gray-700' : ''}`}>
                            {showAnime ? (
                                <Link to={`/anime/${review.anime?.slug}`} className="block w-full h-full">
                                    {review.anime?.cover_image ? (
                                        <img src={review.anime.cover_image} alt={review.anime.title} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-dark-50" />
                                    )}
                                </Link>
                            ) : (
                                <Link to={`/profile/${review.user?.username}`} className="block">
                                    {review.user?.avatar ? (
                                        <img src={review.user.avatar} alt={review.user.username} className="w-9 h-9 rounded-full object-cover border border-gray-700" />
                                    ) : (
                                        <LetterAvatar name={review.user?.username} size="md" />
                                    )}
                                </Link>
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                {showAnime ? (
                                    <Link to={`/anime/${review.anime?.slug}`} className="font-semibold text-white text-sm line-clamp-1 hover:text-accent transition-colors">
                                        {review.anime?.title}
                                    </Link>
                                ) : (
                                    <Link to={`/profile/${review.user?.username}`} className="font-medium text-white text-sm hover:text-accent transition-colors">
                                        {review.user?.username}
                                    </Link>
                                )}
                                <span className="text-[10px] text-gray-700">
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

                        {/* Menu (Owner Only) */}
                        {isOwner && onDelete && (
                            <div className="relative shrink-0">
                                <button
                                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    <MoreVertical className="w-4 h-4" />
                                </button>

                                {isMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
                                        <div className="absolute right-0 top-full mt-1 w-28 bg-dark-200 rounded-lg border border-gray-700 shadow-xl z-20 overflow-hidden">
                                            {onEdit && (
                                                <button
                                                    onClick={() => { onEdit(review); setIsMenuOpen(false); }}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
                                                >
                                                    <Edit2 className="w-3 h-3" /> Edit
                                                </button>
                                            )}
                                            <button
                                                onClick={() => { onDelete(review.id); setIsMenuOpen(false); }}
                                                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2"
                                            >
                                                <Trash2 className="w-3 h-3" /> Delete
                                            </button>
                                        </div>
                                    </>
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

                    {/* Helpful Button - Ghost style */}
                    <div className="mt-3 pt-3 border-t border-gray-800/30 flex items-center">
                        <button
                            onClick={handleVote}
                            disabled={!isAuthenticated || isOwner || voteMutation.isPending}
                            className={`flex items-center gap-1.5 text-[11px] transition-all rounded-full px-2 py-1 ${hasVoted
                                ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                                : 'text-gray-500 hover:text-gray-400 border border-transparent hover:border-gray-700'
                                } ${(!isAuthenticated || isOwner) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            title={!isAuthenticated ? 'Login to vote' : isOwner ? 'Cannot vote on your own review' : 'Mark as helpful'}
                        >
                            <ThumbsUp className={`w-3 h-3 ${hasVoted ? 'fill-green-400' : ''}`} />
                            <span>Helpful</span>
                            {helpfulCount > 0 && <span>({helpfulCount})</span>}
                        </button>
                    </div>
                </div>

                {/* Right Column: Scorecard (desktop only) */}
                {hasSubRatings && (
                    <div className="hidden lg:flex w-44 shrink-0 bg-dark-50/50 border-l border-gray-800/50 p-3 flex-col justify-center gap-2">
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
