import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { getOptimizedImageUrl } from '../../utils/imageUtils';

function AnimeListRow({ anime, titleLanguage = 'en' }) {
    const displayTitle = titleLanguage === 'jp' && anime.title_jp
        ? anime.title_jp
        : anime.title;
    const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');

    const getStatusStyle = (status) => {
        if (status === 'Airing') {
            return 'bg-green-500/20 text-green-400 border border-green-500/30';
        }
        if (status === 'Upcoming') {
            return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
        }
        return 'bg-gray-500/20 text-gray-400 border border-gray-500/30';
    };

    return (
        <Link
            to={`/anime/${anime.slug}`}
            className="relative flex gap-3 sm:gap-5 p-2.5 sm:p-4 bg-dark-100 hover:bg-dark-100/80 rounded-2xl border border-gray-800/60 hover:border-accent/40   transition-all duration-300 group overflow-hidden"
        >
            {/* Hover Glow Effect */}
            <div className="absolute -inset-1 bg-dark-50 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            {/* Left: Image Container */}
            <div className="relative flex-shrink-0 z-10">
                <img
                    src={imageUrl}
                    alt={anime.title}
                    loading="lazy"
                    className="w-[85px] sm:w-[100px] h-[120px] sm:h-[140px] object-cover rounded-xl  ring-1 ring-white/5 group-hover:ring-accent/20 transition-all duration-300"
                />

                {/* Mobile Rating Badge */}
                {anime.rating && (
                    <div className="sm:hidden absolute top-1.5 right-1.5 flex items-center gap-1 bg-dark-200/90  px-1.5 py-0.5 rounded-lg border border-white/10 ">
                        <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                        <span className="text-[11px] font-bold text-white">{anime.rating}</span>
                    </div>
                )}
            </div>

            {/* Middle: Content Area */}
            <div className="flex-1 min-w-0 flex flex-col justify-center py-1 z-10">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                    <h3 className="text-base sm:text-xl font-black text-white group-hover:text-accent transition-colors line-clamp-1 sm:line-clamp-2 leading-tight tracking-tight">
                        {displayTitle}
                    </h3>
                </div>

                {/* Metadata Row */}
                <div className="flex items-center gap-x-2 gap-y-1 text-[11px] sm:text-sm text-gray-400 mb-3 flex-wrap">
                    <span className="text-accent font-bold uppercase tracking-wider">{anime.anime_type}</span>
                    <span className="w-1 h-1 rounded-full bg-gray-700" />
                    <span className="text-gray-300 font-medium">{anime.episode_count || '?'} eps</span>
                    {(anime.start_date || anime.release_date) && (
                        <>
                            <span className="w-1 h-1 rounded-full bg-gray-700" />
                            <span className="text-gray-300">
                                {new Date(anime.start_date || anime.release_date).getFullYear()}
                            </span>
                        </>
                    )}
                    {anime.status && (
                        <span className={`ml-1 text-[9px] sm:text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-tighter ${getStatusStyle(anime.status)}`}>
                            {anime.status}
                        </span>
                    )}
                </div>

                {/* Tags & Studio */}
                <div className="mt-auto flex items-end justify-between gap-4">
                    <div className="flex flex-wrap gap-1.5">
                        {anime.genres?.slice(0, 3).map((genre) => (
                            <span
                                key={genre.id}
                                className="px-2 py-0.5 bg-dark-50/50 text-[10px] sm:text-xs text-gray-400 rounded-lg border border-gray-800 "
                            >
                                {genre.name}
                            </span>
                        ))}
                        {(anime.studio_name || anime.studios?.[0]?.name) && (
                            <span className="hidden xs:inline-flex px-2 py-0.5 bg-accent/5 text-[10px] sm:text-xs text-accent/80 font-semibold rounded-lg border border-accent/10">
                                {anime.studio_name || anime.studios?.[0]?.name}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Right: Score (Desktop) */}
            {anime.rating && (
                <div className="hidden sm:flex flex-col items-end justify-center min-w-[80px] pr-2 z-10">
                    <div className="flex items-center gap-1.5 text-yellow-500 mb-0.5">
                        <Star className="w-5 h-5 fill-current" />
                        <span className="text-2xl font-black italic tracking-tighter">{anime.rating}</span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] mr-1">Rating</span>
                </div>
            )}
        </Link>
    );
}

AnimeListRow.propTypes = {
    anime: PropTypes.shape({
        id: PropTypes.number,
        slug: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        title_jp: PropTypes.string,
        cover_image: PropTypes.string,
        cover_image_small: PropTypes.string,
        cover_image_medium: PropTypes.string,
        status: PropTypes.string,
        anime_type: PropTypes.string,
        episode_count: PropTypes.number,
        start_date: PropTypes.string,
        release_date: PropTypes.string,
        studio_name: PropTypes.string,
        studios: PropTypes.arrayOf(PropTypes.shape({
            name: PropTypes.string
        })),
        rating: PropTypes.number,
        genres: PropTypes.arrayOf(PropTypes.shape({
            id: PropTypes.number.isRequired,
            name: PropTypes.string.isRequired
        }))
    }).isRequired,
    titleLanguage: PropTypes.oneOf(['en', 'jp'])
};

export default AnimeListRow;
