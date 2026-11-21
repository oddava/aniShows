import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import { statusMeta } from '../../utils/listStatus';
import QuickAdd from '../ui/QuickAdd';

/** Browse compact view: a poster tile with your status and the same quick add (B4). */
function AnimeMinimalCard({ anime, titleLanguage = 'en' }) {
    const { isAuthenticated } = useAuth();
    const { entry, setStatus, setScore, remove, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count },
        entry: anime.user_list_status,
    });
    const displayTitle = titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title;
    const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
    const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');
    const meta = statusMeta(entry.status);

    return (
        <div className="group relative aspect-[2/3]">
            <Link
                to={`/anime/${anime.slug}`}
                title={displayTitle}
                className="block h-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)]"
            >
                <img
                    src={imageUrl}
                    alt={displayTitle}
                    loading="lazy"
                    onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                    className="h-full w-full object-cover"
                />
                {meta && (
                    <span
                        aria-hidden="true"
                        className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[rgb(11_13_16/0.7)]"
                        style={{ backgroundColor: meta.color }}
                    />
                )}
                {meta && <span className="sr-only">On your list: {meta.label}</span>}
            </Link>
            {isAuthenticated && (
                <QuickAdd
                    status={entry.status}
                    score={entry.score}
                    title={displayTitle}
                    pending={isPending}
                    onSelect={(value) => setStatus(value)}
                    onScore={(value) => setScore(value)}
                    onRemove={() => remove()}
                    className="card-reveal absolute bottom-1 right-1 z-10"
                />
            )}
        </div>
    );
}

AnimeMinimalCard.propTypes = {
    anime: PropTypes.shape({
        id: PropTypes.number,
        slug: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        title_jp: PropTypes.string,
        episode_count: PropTypes.number,
        user_list_status: PropTypes.object,
    }).isRequired,
    titleLanguage: PropTypes.oneOf(['en', 'jp']),
};

export default AnimeMinimalCard;
