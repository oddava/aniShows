import { useState, useEffect, useRef } from 'react';
import { Star, AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react';

// Helper component for 5-star input (handles 1-10 backend value)
const StarInput = ({ label, value, onChange, size = "md" }) => {
    const [hoverValue, setHoverValue] = useState(0);

    const handleInteraction = (e, index) => {
        const rect = e.currentTarget.getBoundingClientRect();
        let clientX;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
        } else {
            clientX = e.clientX;
        }
        const x = clientX - rect.left;
        const isHalf = x < rect.width / 2;
        return (index * 2) + (isHalf ? 1 : 2);
    };

    return (
        <div className="flex flex-col gap-1">
            {label && <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>}
            <div className="flex items-center gap-4">
                <div className="flex items-center">
                    {[0, 1, 2, 3, 4].map((index) => {
                        const starValue = (index * 2) + 2;
                        const isFull = (hoverValue || value) >= starValue;
                        const isHalf = (hoverValue || value) === starValue - 1;

                        return (
                            <button
                                key={index}
                                type="button"
                                onMouseMove={(e) => setHoverValue(handleInteraction(e, index))}
                                onMouseLeave={() => setHoverValue(0)}
                                onClick={(e) => {
                                    const val = handleInteraction(e, index);
                                    onChange(val);
                                    setHoverValue(0);
                                }}
                                onTouchStart={(e) => {
                                    const val = handleInteraction(e, index);
                                    setHoverValue(val);
                                }}
                                onTouchEnd={(e) => {
                                    // Small delay allows the "tap" to be felt without sticking
                                    setTimeout(() => setHoverValue(0), 100);
                                }}
                                className={`p-0.5 focus:outline-none transition-transform hover:scale-110 relative touch-manipulation`}
                            >
                                <Star
                                    className={`${size === "lg" ? "w-8 h-8" : "w-5 h-5"} transition-colors
                                        ${isFull ? "fill-yellow-500 text-yellow-500" : "text-gray-700"}
                                    `}
                                />
                                {isHalf && (
                                    <div className="absolute inset-0 overflow-hidden w-[50%] pointer-events-none">
                                        <Star className={`${size === "lg" ? "w-8 h-8" : "w-5 h-5"} fill-yellow-500 text-yellow-500`} />
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
                <span className={`font-bold text-yellow-500 ${size === "lg" ? "text-2xl" : "text-lg"}`}>
                    {(hoverValue || value) > 0 ? ((hoverValue || value) / 2).toFixed(1) : '-'}
                </span>
            </div>
        </div>
    );
};

export default function ReviewForm({ initialData, onSubmit, onCancel, animeTitle }) {
    const [rating, setRating] = useState(0);
    const [subRatings, setSubRatings] = useState({
        story: 0,
        animation: 0,
        music: 0,
        characters: 0
    });
    const [text, setText] = useState('');
    const [hasSpoilers, setHasSpoilers] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Limits
    const MIN_LENGTH = 0;
    const MAX_LENGTH = 5000;

    const hasLoaded = useRef(false);

    useEffect(() => {
        if (hasLoaded.current) return;

        if (initialData) {
            console.log('[ReviewForm] Initializing with data:', initialData);
            setRating(initialData.rating || 0);

            const loadedSubRatings = {
                story: initialData.rating_story || 0,
                animation: initialData.rating_animation || 0,
                music: initialData.rating_music || 0,
                characters: initialData.rating_characters || 0
            };
            setSubRatings(loadedSubRatings);

            // Show advanced section if any sub-rating is present
            const hasAnySubRating = Object.values(loadedSubRatings).some(v => v > 0);
            setShowAdvanced(hasAnySubRating);

            // Decoded text to handle accidentally escaped data from DB
            let loadedText = (initialData.text || '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");

            setText(loadedText);
            setHasSpoilers(initialData.has_spoilers || false);
            hasLoaded.current = true;
        } else {
            // Check for drafts if not editing
            const draftKey = `review_draft_${animeTitle.replace(/\s+/g, '_').toLowerCase()}`;
            const draft = localStorage.getItem(draftKey);
            if (draft) {
                try {
                    const parsed = JSON.parse(draft);
                    if (parsed.text) setText(parsed.text);
                    if (parsed.rating !== undefined) setRating(parsed.rating);
                    if (parsed.subRatings) setSubRatings(parsed.subRatings);
                    if (parsed.hasSpoilers !== undefined) setHasSpoilers(parsed.hasSpoilers);
                } catch (e) {
                    console.error('Failed to load draft:', e);
                }
            }
            hasLoaded.current = true;
        }
    }, [initialData, animeTitle]);

    // Save draft on change (only for new reviews)
    useEffect(() => {
        const hasAnyContent = text.trim().length > 0 ||
            rating > 0 ||
            Object.values(subRatings).some(v => v > 0);

        if (!initialData && hasAnyContent) {
            const draftKey = `review_draft_${animeTitle.replace(/\s+/g, '_').toLowerCase()}`;
            const draft = { text, rating, subRatings, hasSpoilers };
            localStorage.setItem(draftKey, JSON.stringify(draft));
        }
    }, [text, rating, subRatings, hasSpoilers, initialData, animeTitle]);


    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (rating === 0) {
            setError('Please select an overall rating');
            return;
        }

        if (text && text.trim().length > 0) {
            if (text.trim().length < MIN_LENGTH) {
                setError(`Review is too short (minimum ${MIN_LENGTH} characters)`);
                return;
            }
            if (text.length > MAX_LENGTH) {
                setError(`Review is too long (maximum ${MAX_LENGTH} characters)`);
                return;
            }
        }

        setIsSubmitting(true);
        try {
            // Filter out 0 values for sub-ratings to send null/undefined
            const cleanSubRatings = Object.entries(subRatings).reduce((acc, [key, val]) => {
                if (val > 0) acc[`rating_${key}`] = val;
                return acc;
            }, {});

            await onSubmit({
                rating,
                ...cleanSubRatings,
                text,
                has_spoilers: hasSpoilers
            });

            // Clear draft on success
            if (!initialData) {
                const draftKey = `review_draft_${animeTitle.replace(/\s+/g, '_').toLowerCase()}`;
                localStorage.removeItem(draftKey);
            }
        } catch (err) {
            console.error('Submission error:', err);
            const data = err.response?.data;
            const status = err.response?.status;

            if (data) {
                if (typeof data === 'string' && data.includes('<!doctype html>')) {
                    setError(`Server Error (${status || 500}). Please check backend logs.`);
                } else if (typeof data === 'string') {
                    setError(data);
                } else if (data.detail) {
                    setError(data.detail);
                } else if (data.non_field_errors) {
                    setError(data.non_field_errors[0]);
                } else {
                    // Collect field errors
                    const fieldErrors = Object.entries(data)
                        .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs[0] : msgs}`)
                        .join(', ');
                    setError(fieldErrors || 'Failed to submit review');
                }
            } else {
                setError('Failed to connect to server. Please try again.');
            }
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-dark-100 rounded-2xl border border-gray-800 p-6 md:p-8 animate-fade-in relative max-w-4xl mx-auto">
            <button
                onClick={onCancel}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                aria-label="Close"
            >
                <X className="w-6 h-6" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-6">
                {initialData ? 'Edit Review' : `Reviewing ${animeTitle}`}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Main Rating */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">Overall Rating</label>
                    <StarInput
                        value={rating}
                        onChange={setRating}
                        size="lg"
                    />
                </div>

                {/* Sub Ratings Toggle */}
                <div className="border-t border-gray-800 pt-4">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center gap-2 text-sm text-accent hover:text-accent/80 transition-colors"
                    >
                        {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        {showAdvanced ? 'Hide Detailed Ratings' : 'Add Detail Ratings (Story, Animation, etc.)'}
                    </button>

                    {showAdvanced && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6 animate-fade-in pl-2 border-l-2 border-gray-800">
                            <StarInput
                                label="Story"
                                value={subRatings.story}
                                onChange={(v) => setSubRatings(prev => ({ ...prev, story: v }))}
                            />
                            <StarInput
                                label="Animation"
                                value={subRatings.animation}
                                onChange={(v) => setSubRatings(prev => ({ ...prev, animation: v }))}
                            />
                            <StarInput
                                label="Music"
                                value={subRatings.music}
                                onChange={(v) => setSubRatings(prev => ({ ...prev, music: v }))}
                            />
                            <StarInput
                                label="Characters"
                                value={subRatings.characters}
                                onChange={(v) => setSubRatings(prev => ({ ...prev, characters: v }))}
                            />
                        </div>
                    )}
                </div>

                {/* Text Input */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">
                        Your Review
                    </label>
                    <div className="relative">
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Share your thoughts..."
                            className={`input min-h-[200px] w-full resize-y text-sm leading-relaxed transition-colors ${text.length > MAX_LENGTH ? 'border-red-500 focus:border-red-500' : ''
                                }`}
                        />
                        <div className="flex items-center justify-end mt-1 px-1">
                            <div className={`text-[10px] font-medium ${text.length > MAX_LENGTH ? 'text-red-500' :
                                text.length > MAX_LENGTH * 0.9 ? 'text-yellow-500' : 'text-gray-500'
                                }`}>
                                {text.length} / {MAX_LENGTH}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Spoilers & Actions */}
                <div className="flex flex-row items-center justify-between gap-6 pt-4 border-t border-gray-800">
                    <label className="flex items-center gap-3 cursor-pointer group select-none hover:bg-white/5 p-2 -ml-2 rounded-lg transition-colors w-fit">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${hasSpoilers ? 'bg-red-500 border-red-500' : 'border-gray-600 bg-dark-50 group-hover:border-gray-500'
                            }`}>
                            {hasSpoilers && <AlertTriangle className="w-3 h-3 text-white" />}
                        </div>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={hasSpoilers}
                            onChange={(e) => setHasSpoilers(e.target.checked)}
                        />
                        <span className="text-gray-300 group-hover:text-white transition-colors">
                            Contains Spoilers
                        </span>
                    </label>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="btn-ghost"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn-primary"
                        >
                            {isSubmitting ? 'Submitting...' : (initialData ? 'Update Review' : 'Submit Review')}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                        {error}
                    </div>
                )}
            </form>
        </div>
    );
}

