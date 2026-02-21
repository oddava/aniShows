import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';

function AnimeListRow({ anime, titleLanguage = 'en' }) {
    const displayTitle = titleLanguage === 'jp' && anime.title_jp 
        ? anime.title_jp 
        : anime.title;

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
            className="flex items-center gap-4 p-4 bg-dark-100/50 hover:bg-dark-100 rounded-xl border border-gray-800 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5 transition-all group"
        >
            <img
                src={anime.cover_image}
                alt={anime.title}
                loading="lazy"
                className="w-16 h-24 object-cover rounded-lg flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-white group-hover:text-accent transition-colors line-clamp-1">
                        {displayTitle}
                    </h3>
                    {anime.status && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getStatusStyle(anime.status)}`}>
                            {anime.status}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300 mt-1 flex-wrap">
                    <span className="text-gray-200">{anime.anime_type}</span>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-200">{anime.episode_count || '?'} eps</span>
                    {(anime.start_date || anime.release_date) && (
                        <>
                            <span className="text-gray-500">•</span>
                            <span className="text-gray-400">
                                {new Date(anime.start_date || anime.release_date).getFullYear()}
                            </span>
                        </>
                    )}
                    {(anime.studio_name || anime.studios?.[0]?.name) && (
                        <>
                            <span className="text-gray-500">•</span>
                            <span className="text-accent/80 font-medium">
                                {anime.studio_name || anime.studios?.[0]?.name}
                            </span>
                        </>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {anime.genres?.slice(0, 4).map((genre) => (
                        <span 
                            key={genre.id} 
                            className="px-2 py-0.5 bg-dark-50 text-xs text-gray-300 rounded-md border border-gray-700"
                        >
                            {genre.name}
                        </span>
                    ))}
                </div>
            </div>
            <div className="text-right flex-shrink-0 flex flex-col items-end gap-2">
                {anime.rating && (
                    <div className="flex items-center gap-1 text-yellow-500">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="font-bold">{anime.rating}</span>
                    </div>
                )}
            </div>
        </Link>
    );
}

AnimeListRow.propTypes = {
    anime: PropTypes.shape({
        id: PropTypes.number,
        slug: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        title_jp: PropTypes.string,
        cover_image: PropTypes.string.isRequired,
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
