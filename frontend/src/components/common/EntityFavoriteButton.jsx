import { useId } from 'react';
import { Heart, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Favorite toggle for a character/staff/anime page. The accessible name says
 * what pressing it does ("Favorite Frieren" / "Unfavorite Frieren"),
 * `aria-pressed` carries the state, and the count stays visible text.
 */
export default function EntityFavoriteButton({
    isAuthenticated,
    isFavorite,
    favoriteCount = 0,
    isPending = false,
    onToggle,
    entityLabel = 'favorite',
}) {
    const countId = useId();
    const compactCount = Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(favoriteCount || 0);
    const countText = compactCount || '0';
    const countLabel = `${countText} ${favoriteCount === 1 ? 'favorite' : 'favorites'}`;

    if (!isAuthenticated) {
        return (
            <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark-100 px-4 py-2.5 text-sm font-bold text-gray-200 transition-colors hover:bg-dark-200 hover:text-white"
                title={`Sign in to favorite this ${entityLabel}`}
                aria-label={`Sign in to favorite ${entityLabel}, ${countLabel}`}
            >
                <Heart className="h-4 w-4" aria-hidden="true" />
                <span>{countText}</span>
            </Link>
        );
    }

    const actionLabel = isFavorite ? `Unfavorite ${entityLabel}` : `Favorite ${entityLabel}`;

    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            aria-pressed={Boolean(isFavorite)}
            aria-label={actionLabel}
            aria-describedby={countId}
            aria-busy={isPending || undefined}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                isFavorite
                    ? 'bg-red-500 text-white'
                    : 'bg-dark-100 text-gray-200 hover:bg-dark-200 hover:text-red-400'
            } ${isPending ? 'cursor-wait opacity-80' : ''}`}
            title={actionLabel}
        >
            {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
                <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />
            )}
            <span id={countId}>{countText}</span>
        </button>
    );
}
