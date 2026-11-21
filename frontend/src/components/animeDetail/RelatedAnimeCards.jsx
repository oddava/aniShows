import { memo } from 'react';
import { Link } from 'react-router-dom';
import AnimeMediaImage from '../common/AnimeMediaImage';

const hasRating = (rating) => rating != null && rating !== '' && rating !== 'N/A' && Number(rating) > 0;

/** "TV · 7.5": the type, and the score only when there is one. */
function metaLine(anime) {
    return [anime.anime_type, hasRating(anime.rating) ? anime.rating : null].filter(Boolean).join(' · ');
}

// A recommended title: poster, title, a quiet meta line.
export const RelatedPosterCard = memo(({ anime }) => {
    const meta = metaLine(anime);

    return (
        <Link to={`/anime/${anime.slug}`} className="group block min-w-0">
            <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] bg-[var(--ink-2)]">
                <AnimeMediaImage
                    anime={anime}
                    kind="cover"
                    size="small"
                    alt={anime.title}
                    className="h-full w-full object-cover text-transparent"
                    loading="lazy"
                />
            </div>
            <h3 className="mt-2 line-clamp-2 text-[15px] font-medium leading-snug text-[var(--text-1)] transition-colors group-hover:text-[var(--signature)]">
                {anime.title}
            </h3>
            {meta && <p className="mt-0.5 text-sm text-[var(--text-3)] tabular">{meta}</p>}
        </Link>
    );
});

RelatedPosterCard.displayName = 'RelatedPosterCard';

const releaseYear = (anime) => {
    const year = Number(String(anime.release_date || anime.year || '').slice(0, 4));
    return year > 1900 ? year : null;
};

// The same title as a list row, for when a few posters would sit sparse:
// cover thumb, title, "TV · 2026", the score on the right.
export const RelatedListRow = memo(({ anime }) => {
    const meta = [anime.anime_type, releaseYear(anime)].filter(Boolean).join(' · ');

    return (
        <Link
            to={`/anime/${anime.slug}`}
            className="group -mx-3 flex items-center gap-4 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
        >
            <div className="h-[60px] w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)]">
                <AnimeMediaImage
                    anime={anime}
                    kind="cover"
                    size="small"
                    alt=""
                    className="h-full w-full object-cover text-transparent"
                    loading="lazy"
                />
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-[var(--text-1)] transition-colors group-hover:text-[var(--signature)]">
                    {anime.title}
                </h3>
                {meta && <p className="mt-0.5 text-sm text-[var(--text-3)] tabular">{meta}</p>}
            </div>
            {hasRating(anime.rating) && (
                <span className="flex-shrink-0 text-[15px] text-[var(--text-2)] tabular">{anime.rating}</span>
            )}
        </Link>
    );
});

RelatedListRow.displayName = 'RelatedListRow';

// Older names, kept for callers that still import them.
export const RelatedAnimeCard = RelatedPosterCard;
export const MobileRelatedCard = RelatedPosterCard;
