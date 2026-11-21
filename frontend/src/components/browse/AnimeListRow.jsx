import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import { statusMeta } from '../../utils/listStatus';
import QuickAdd from '../ui/QuickAdd';
import { ScoreBadge } from '../ui/Badge';

/**
 * Browse list view: the same facts and the same quick add as the grid card
 * (B4), laid out as a row.
 */
function AnimeListRow({ anime, titleLanguage = 'en' }) {
    const { isAuthenticated } = useAuth();
    const { entry, setStatus, setScore, remove, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry: anime.user_list_status,
    });
    const displayTitle = titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title;
    const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
    const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');
    const meta = statusMeta(entry.status);
    const year = anime.start_date || anime.release_date ? new Date(anime.start_date || anime.release_date).getFullYear() : null;
    const href = `/anime/${anime.slug}`;

    return (
        <div className="group relative flex items-center gap-3 sm:gap-5 rounded-[var(--radius-lg)] bg-[var(--ink-1)] p-2.5 sm:p-3 transition-colors hover:bg-[var(--ink-2)]">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="relative shrink-0">
                <img
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                    className="h-[108px] w-[72px] sm:h-[120px] sm:w-[80px] rounded-[var(--radius-sm)] bg-[var(--ink-3)] object-cover"
                />
                {entry.score > 0 && <ScoreBadge score={entry.score} className="absolute left-1 top-1 !h-5 !px-1 text-[11px]" />}
            </Link>

            <div className="min-w-0 flex-1">
                <Link to={href} className="flex items-start gap-2 rounded-sm">
                    {meta && <span aria-hidden="true" className="mt-[0.45rem] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />}
                    <h3 className="line-clamp-2 text-[15px] sm:text-base font-semibold leading-snug text-gray-100 group-hover:text-white">
                        {displayTitle}
                    </h3>
                </Link>
                {meta && <span className="sr-only">On your list: {meta.label}</span>}
                <p className="mt-1 text-sm text-[var(--text-2)] tabular">
                    {[anime.anime_type, anime.episode_count > 0 ? `${anime.episode_count} eps` : null, year, anime.status]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
                {anime.genres?.length > 0 && (
                    <p className="mt-2 hidden truncate text-xs text-gray-500 xs:block">
                        {anime.genres.slice(0, 3).map((genre) => genre.name).join(' · ')}
                        {(anime.studio_name || anime.studios?.[0]?.name) && ` — ${anime.studio_name || anime.studios?.[0]?.name}`}
                    </p>
                )}
            </div>

            {anime.rating ? (
                <div className="hidden sm:flex w-16 shrink-0 items-center justify-end gap-1 text-sm font-semibold text-gray-200 tabular" title="Average rating">
                    <Star aria-hidden="true" className="h-4 w-4 fill-[var(--status-on-hold)] text-[var(--status-on-hold)]" />
                    <span className="sr-only">Average rating </span>{anime.rating}
                </div>
            ) : null}

            {isAuthenticated && (
                <QuickAdd
                    status={entry.status}
                    score={entry.score}
                    watched={entry.episodes_watched || 0}
                    total={Number(anime.episode_count) > 0 ? Number(anime.episode_count) : null}
                    title={displayTitle}
                    pending={isPending}
                    onSelect={(value) => setStatus(value)}
                    onScore={(value) => setScore(value)}
                    onRemove={() => remove()}
                    className="relative shrink-0 self-center"
                />
            )}
        </div>
    );
}

AnimeListRow.propTypes = {
    anime: PropTypes.shape({
        id: PropTypes.number,
        slug: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        title_jp: PropTypes.string,
        status: PropTypes.string,
        anime_type: PropTypes.string,
        episode_count: PropTypes.number,
        start_date: PropTypes.string,
        release_date: PropTypes.string,
        studio_name: PropTypes.string,
        studios: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string })),
        rating: PropTypes.number,
        genres: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.number, name: PropTypes.string })),
        user_list_status: PropTypes.object,
    }).isRequired,
    titleLanguage: PropTypes.oneOf(['en', 'jp']),
};

export default AnimeListRow;
