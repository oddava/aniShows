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
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-4 text-sm font-semibold text-[var(--text-1)] transition-colors duration-150 hover:bg-white/[0.1]"
                title={`Sign in to favorite ${entityLabel}`}
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
            // The visible count is part of the name (WCAG 2.5.3).
            aria-label={`${actionLabel}, ${countLabel}`}
            aria-busy={isPending || undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold tabular transition-colors duration-150 ${
                isFavorite
                    ? 'bg-[var(--signature-soft)] text-[var(--signature)]'
                    : 'bg-white/[0.06] text-[var(--text-1)] hover:bg-white/[0.1]'
            } ${isPending ? 'cursor-wait opacity-80' : ''}`}
            title={actionLabel}
        >
            {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
                <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />
            )}
            <span>{countText}</span>
        </button>
    );
}
