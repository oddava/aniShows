import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';

function AnimeMinimalCard({ anime, titleLanguage = 'en' }) {
    const displayTitle = titleLanguage === 'jp' && anime.title_jp 
        ? anime.title_jp 
        : anime.title;

    return (
        <Link
            to={`/anime/${anime.slug}`}
            className="block aspect-[2/3] rounded-lg overflow-hidden relative group"
        >
            <img
                src={anime.cover_image}
                alt={anime.title}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-2 left-2 right-2">
                    <h3 className="text-xs font-bold text-white line-clamp-2">
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
        cover_image: PropTypes.string.isRequired
    }).isRequired,
    titleLanguage: PropTypes.oneOf(['en', 'jp'])
};

export default AnimeMinimalCard;
