import { Link } from 'react-router-dom';
import { TrendingUp, ChevronRight, Star } from 'lucide-react';
import PropTypes from 'prop-types';

export default function TrendingCarousel({ 
  anime = [], 
  onSeeAll,
  titleLanguage = 'en',
  isLoading = false,
  isError = false 
}) {
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

  const displayAnime = anime.slice(0, 6);

  return (
    <div className="mb-8 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-accent/10 rounded-lg">
            <TrendingUp className="w-4 h-4 text-accent" />
          </div>
          <h2 className="text-base font-semibold text-white">Trending Now</h2>
        </div>
        
        <button
          onClick={onSeeAll}
          className="text-xs font-medium text-accent hover:text-white transition-colors flex items-center gap-0.5 group"
        >
          See all
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
      
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {displayAnime.map((item, index) => (
          <Link
            key={item.id}
            to={`/anime/${item.slug}`}
            className="group relative"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-dark-100 mb-2 ring-1 ring-transparent group-hover:ring-accent/30 transition-all duration-300">
              <img
                src={item.cover_image}
                alt={item.title}
                loading={index < 3 ? "eager" : "lazy"}
                className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105"
              />
              
              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-2">
                <h4 className="font-semibold text-[11px] text-white mb-1 line-clamp-2">
                  {item.title}
                </h4>
                
                <div className="flex items-center gap-1.5 text-[10px] text-gray-300 mb-1">
                  {item.rating && (
                    <span className="flex items-center gap-0.5 text-yellow-400">
                      <Star className="w-3 h-3 fill-current" />
                      {item.rating}
                    </span>
                  )}
                  <span>{item.anime_type}</span>
                  
                  {item.episode_count && (
                    <span>{item.episode_count} eps</span>
                  )}
                </div>
                
                <div className="flex items-center gap-1 text-[9px] text-accent truncate">
                  {item.genres?.slice(0, 2).map((genre, idx) => (
                    <span key={genre.id} className="truncate">
                      {genre.name}{idx < Math.min(item.genres?.length || 0, 2) - 1 ? ',' : ''}
                    </span>
                  ))}
                  {(item.genres?.length || 0) > 2 && (
                    <span className="text-gray-400 flex-shrink-0">
                      +{(item.genres?.length || 0) - 2}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {item.user_list_status?.status === 'Watching' && item.episode_count > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60 z-10">
                  <div
                    style={{ 
                      width: `${Math.min((item.user_list_status.episodes_watched / item.episode_count) * 100, 100)}%` 
                    }}
                    className="h-full bg-accent"
                  />
                </div>
              )}
            </div>
            
            <h3 className="text-xs font-medium text-white line-clamp-2 group-hover:text-accent transition-colors">
              {titleLanguage === 'jp' && item.title_jp 
                ? item.title_jp 
                : item.title
              }
            </h3>
          </Link>
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