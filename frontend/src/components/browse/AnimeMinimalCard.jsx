import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import useAnimeAccentColor from '../../hooks/useAnimeAccentColor';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';

function AnimeMinimalCard({ anime, titleLanguage = 'en' }) {
    const displayTitle = titleLanguage === 'jp' && anime.title_jp 
        ? anime.title_jp 
        : anime.title;
    const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
    const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');
    const accentColor = useAnimeAccentColor(
        imageUrl,
        getOptimizedImageUrl(anime, 'cover', 'large'),
        anime.cover_image,
        anime.cover_image_external_url,
        getOptimizedImageUrl(anime, 'banner', 'medium')
    );

    return (
        <Link
            to={`/anime/${anime.slug}`}
            className="block aspect-[2/3] rounded-lg overflow-hidden relative group"
            style={{ '--anime-title-hover-color': accentColor || 'var(--color-accent)' }}
        >
            <img
                src={imageUrl}
                alt={anime.title}
                loading="lazy"
                onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                className="w-full h-full object-cover  transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-2 left-2 right-2">
                    <h3 className="text-xs font-bold text-white group-hover:text-[var(--anime-title-hover-color)] transition-colors line-clamp-2">
                        {displayTitle}
                    </h3>
                </div>
            </div>
        </Link>
    );
}

AnimeMinimalCard.propTypes = {
    anime: PropTypes.shape({
        id: PropTypes.number,
        slug: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        title_jp: PropTypes.string,
        cover_image: PropTypes.string,
        cover_image_small: PropTypes.string,
        cover_image_medium: PropTypes.string,
        cover_image_large: PropTypes.string,
        cover_image_external_url: PropTypes.string,
        banner_image_medium: PropTypes.string,
        banner_image_external_url: PropTypes.string
    }).isRequired,
    titleLanguage: PropTypes.oneOf(['en', 'jp'])
};

export default AnimeMinimalCard;
