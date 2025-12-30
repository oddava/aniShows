import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, User, AlertTriangle, Eye, EyeOff, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../context/AuthContext';

export default function ReviewCard({ review, onEdit, onDelete, showAnime = false }) {
    const { user } = useAuth();
    const [showSpoilers, setShowSpoilers] = useState(!review.has_spoilers);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const isOwner = user?.username === review.user?.username;

    return (
        <div className="bg-dark-100 rounded-xl p-6 border border-gray-800 animate-fade-in mb-4">
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                    {/* Avatar/Cover */}
                    <div className={`overflow-hidden border border-gray-700 ${showAnime ? 'w-12 h-16 rounded-md' : 'w-10 h-10 rounded-full'}`}>
                        {showAnime ? (
                            <Link to={`/anime/${review.anime?.slug}`} className="block w-full h-full">
                                {review.anime?.cover_image ? (
                                    <img src={review.anime.cover_image} alt={review.anime.title} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-dark-50" />
                                )}
                            </Link>
                        ) : (
                            <Link to={`/profile/${review.user?.username}`} className="block w-full h-full">
                                {review.user?.avatar ? (
                                    <img src={review.user.avatar} alt={review.user.username} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-dark-50 text-gray-500">
                                        <User className="w-5 h-5" />
                                    </div>
                                )}
                            </Link>
                        )}
                    </div>

                    {/* Info */}
                    <div>
                        <div className="flex items-baseline gap-2">
                            {showAnime ? (
                                <Link to={`/anime/${review.anime?.slug}`} className="font-bold text-white line-clamp-1 hover:text-accent transition-colors">
                                    {review.anime?.title}
                                </Link>
                            ) : (
                                <Link to={`/profile/${review.user?.username}`} className="font-semibold text-white hover:text-accent transition-colors">
                                    {review.user?.username}
                                </Link>
                            )}
                            <span className="text-xs text-gray-500">
                                {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                            </span>
                        </div>
                        {/* Rating */}
                        <div className="flex items-center gap-1 text-yellow-500 mt-1">
                            {Array(10).fill(0).map((_, i) => (
                                <Star
                                    key={i}
                                    className={`w-3 h-3 ${i < review.rating ? 'fill-current' : 'text-gray-700'}`}
                                />
                            ))}
                            <span className="text-xs text-gray-400 ml-2 font-medium">{review.rating}/10</span>
                        </div>
                    </div>
                </div>

                {/* Menu (Owner Only) - Only show if not showAnime (profile view usually implies owner but let's be safe) 
                   Actually on profile view we might want to delete too. But review card needs onDelete handler.
                */}
                {isOwner && onDelete && (
                    <div className="relative">
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="p-1 hover:bg-white/10 rounded-lg text-gray-400 transition-colors"
                        >
                            <MoreVertical className="w-5 h-5" />
                        </button>

                        {isMenuOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setIsMenuOpen(false)}
                                />
                                <div className="absolute right-0 top-full mt-2 w-32 bg-dark-200 rounded-lg border border-gray-700 shadow-xl z-20 overflow-hidden">
                                    {onEdit && (
                                        <button
                                            onClick={() => { onEdit(review); setIsMenuOpen(false); }}
                                            className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
                                        >
                                            <Edit2 className="w-3 h-3" /> Edit
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { onDelete(review.id); setIsMenuOpen(false); }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2"
                                    >
                                        <Trash2 className="w-3 h-3" /> Delete
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="relative">
                {review.has_spoilers && !showSpoilers ? (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[100px]">
                        <div className="flex items-center gap-2 text-red-400 font-medium">
                            <AlertTriangle className="w-4 h-4" />
                            <span>Contains Spoilers</span>
                        </div>
                        <button
                            onClick={() => setShowSpoilers(true)}
                            className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
                        >
                            <Eye className="w-3 h-3" /> Show Review
                        </button>
                    </div>
                ) : (
                    <div>
                        {review.text ? (
                            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                                {review.text}
                            </p>
                        ) : (
                            <p className="text-gray-500 text-sm italic">No text review provided.</p>
                        )}

                        {review.has_spoilers && (
                            <button
                                onClick={() => setShowSpoilers(false)}
                                className="mt-4 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition-colors"
                            >
                                <EyeOff className="w-3 h-3" /> Hide Spoilers
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
