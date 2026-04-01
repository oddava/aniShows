import { Heart, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function EntityFavoriteButton({
    isAuthenticated,
    isFavorite,
    favoriteCount = 0,
    isPending = false,
    onToggle,
    entityLabel = 'favorite',
}) {
    const compactCount = Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(favoriteCount);

    if (!isAuthenticated) {
        return (
            <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark-100 px-4 py-2.5 text-sm font-bold text-gray-200 transition-colors hover:bg-dark-200 hover:text-white"
                title={`Sign in to favorite this ${entityLabel}`}
            >
                <Heart className="h-4 w-4" />
                <span>{compactCount || '0'}</span>
            </Link>
        );
    }

    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                isFavorite
                    ? 'bg-red-500 text-white'
                    : 'bg-dark-100 text-gray-200 hover:bg-dark-200 hover:text-red-400'
            } ${isPending ? 'cursor-wait opacity-80' : ''}`}
            title={isFavorite ? `Unfavorite ${entityLabel}` : `Favorite ${entityLabel}`}
        >
            {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
                <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
            )}
            <span>{compactCount || '0'}</span>
        </button>
    );
}
