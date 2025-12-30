import { useState, useEffect } from 'react';
import { Star, AlertTriangle, X } from 'lucide-react';

export default function ReviewForm({ initialData, onSubmit, onCancel, animeTitle }) {
    const [rating, setRating] = useState(0);
    const [text, setText] = useState('');
    const [hasSpoilers, setHasSpoilers] = useState(false);
    const [hoverRating, setHoverRating] = useState(0);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (initialData) {
            setRating(initialData.rating);
            setText(initialData.text || '');
            setHasSpoilers(initialData.has_spoilers || false);
        }
    }, [initialData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (rating === 0) {
            setError('Please select a rating');
            return;
        }

        setIsSubmitting(true);
        try {
            await onSubmit({
                rating,
                text,
                has_spoilers: hasSpoilers
            });
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Failed to submit review');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-dark-100 rounded-2xl border border-gray-800 p-6 md:p-8 animate-fade-in relative">
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
                {/* Rating Input */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">
                        Your Rating
                    </label>
                    <div className="flex items-center gap-2">
                        <div
                            className="flex items-center gap-1"
                            onMouseLeave={() => setHoverRating(0)}
                        >
                            {Array(10).fill(0).map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => setRating(i + 1)}
                                    onMouseEnter={() => setHoverRating(i + 1)}
                                    className="p-1 focus:outline-none transition-transform hover:scale-110"
                                >
                                    <Star
                                        className={`w-6 h-6 md:w-8 md:h-8 transition-colors ${(hoverRating || rating) > i
                                                ? 'fill-current text-yellow-500'
                                                : 'text-gray-700'
                                            }`}
                                    />
                                </button>
                            ))}
                        </div>
                        <span className="text-xl font-bold text-yellow-500 ml-4 min-w-[3ch]">
                            {hoverRating || rating || 0}
                        </span>
                        <span className="text-gray-500 text-sm">/ 10</span>
                    </div>
                </div>

                {/* Text Input */}
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Stats & Details (Optional)
                    </label>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="What did you think about this anime? (Optional)"
                        className="input min-h-[150px] w-full resize-none leading-relaxed"
                    />
                </div>

                {/* Spoilers & Actions */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <label className="flex items-center gap-3 cursor-pointer group select-none">
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
