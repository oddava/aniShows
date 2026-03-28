import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import { useTheme } from '../../context/ThemeContext';
import AnimeCard from '../AnimeCard';

export default function TrendingCarousel({
  anime = [],
  onSeeAll,
  titleLanguage = 'en',
  isLoading = false,
  isError = false
}) {
  const { theme } = useTheme();
  const isRetro = theme && theme.startsWith('retro-');

  if (isError) {
    return (
      <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
        <p className="text-sm text-red-400 font-medium">Failed to load trending anime</p>
      </div>
    );
  }

  if (isLoading || !anime?.length) {
    return null;
  }

  const displayAnime = anime.slice(0, 7);

  return (
    <div className={`mb-8 animate-fade-in ${isRetro ? 'retro-window p-4 pb-2' : ''}`} data-title="Trending Now">
      {!isRetro ? (
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-lg md:text-xl font-bold text-gray-400 tracking-tight">Trending Now</h2>
          </div>

          <button
            onClick={onSeeAll}
            className="text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1 group pb-1"
          >
            See all
          </button>
        </div>
      ) : (
        <div className="flex justify-end mb-3 border-b border-gray-600 pb-1">
          <button
            onClick={onSeeAll}
            className="bg-[#d4d0c8] text-black px-2 py-0.5 text-xs border-2 border-white border-r-gray-500 border-b-gray-500 active:border-gray-500 active:border-r-white active:border-b-white"
          >
            See all &gt;
          </button>
        </div>
      )}

      <div className="max-w-6xl mx-auto grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 gap-8 lg:gap-10">
        {displayAnime.map((item, index) => (
          <AnimeCard
            key={item.id}
            anime={item}
            titleLanguage={titleLanguage}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

TrendingCarousel.propTypes = {
  anime: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    slug: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    title_jp: PropTypes.string,
    cover_image: PropTypes.string.isRequired,
    rating: PropTypes.number,
    anime_type: PropTypes.string,
    episode_count: PropTypes.number,
    genres: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string
    })),
    user_list_status: PropTypes.shape({
      status: PropTypes.string,
      episodes_watched: PropTypes.number
    })
  })),
  onSeeAll: PropTypes.func.isRequired,
  titleLanguage: PropTypes.string,
  isLoading: PropTypes.bool,
  isError: PropTypes.bool
};

TrendingCarousel.defaultProps = {
  anime: [],
  titleLanguage: 'en',
  isLoading: false,
  isError: false
};
