import { X } from 'lucide-react';
import PropTypes from 'prop-types';

export default function ActiveFilterChips({
  currentTypes,
  currentStatuses,
  currentSeason,
  currentYear,
  currentMinRating,
  currentMaxRating,
  currentStudio,
  currentGenres,
  currentTags,
  currentSource,
  currentMinEpisodes,
  currentMaxEpisodes,
  currentMinDuration,
  currentMaxDuration,
  currentMinYear,
  currentMaxYear,
  typeOptions,
  statusOptions,
  seasonOptions,
  sourceOptions,
  studios,
  genres,
  onClearType,
  onClearStatus,
  onClearSeason,
  onClearMinRating,
  onClearMaxRating,
  onClearStudio,
  onToggleGenre,
  onToggleTag,
  onClearSource,
  onClearMinEpisodes,
  onClearMaxEpisodes,
  onClearMinDuration,
  onClearMaxDuration,
  onClearYearRange,
  onClearAll,
  hasActiveFilters
}) {
  if (!hasActiveFilters) return null;

  const filters = [];

  if (currentTypes) {
    filters.push({
      key: 'type',
      label: typeOptions.find(t => t.value === currentTypes)?.label,
      onClear: onClearType
    });
  }

  if (currentStatuses) {
    filters.push({
      key: 'status',
      label: statusOptions.find(s => s.value === currentStatuses)?.label,
      onClear: onClearStatus
    });
  }

  if (currentSeason) {
    filters.push({
      key: 'season',
      label: `${seasonOptions.find(s => s.value === currentSeason)?.label.split(' ')[0]} ${currentYear || ''}`.trim(),
      onClear: onClearSeason
    });
  }

  if (currentMinRating) {
    filters.push({
      key: 'minRating',
      label: `Rating ≥ ${currentMinRating}`,
      onClear: onClearMinRating
    });
  }

  if (currentMaxRating) {
    filters.push({
      key: 'maxRating',
      label: `Rating ≤ ${currentMaxRating}`,
      onClear: onClearMaxRating
    });
  }

  if (currentStudio) {
    filters.push({
      key: 'studio',
      label: studios?.find(s => s.id.toString() === currentStudio)?.name,
      onClear: onClearStudio
    });
  }

  if (currentSource) {
    filters.push({
      key: 'source',
      label: sourceOptions.find(s => s.value === currentSource)?.label || currentSource,
      onClear: onClearSource,
    });
  }

  if (currentMinEpisodes) {
    filters.push({
      key: 'minEpisodes',
      label: `Episodes ≥ ${currentMinEpisodes}`,
      onClear: onClearMinEpisodes,
    });
  }

  if (currentMaxEpisodes) {
    filters.push({
      key: 'maxEpisodes',
      label: `Episodes ≤ ${currentMaxEpisodes}`,
      onClear: onClearMaxEpisodes,
    });
  }

  if (currentMinDuration) {
    filters.push({
      key: 'minDuration',
      label: `Duration ≥ ${currentMinDuration}m`,
      onClear: onClearMinDuration,
    });
  }

  if (currentMaxDuration) {
    filters.push({
      key: 'maxDuration',
      label: `Duration ≤ ${currentMaxDuration}m`,
      onClear: onClearMaxDuration,
    });
  }

  if (currentMinYear || currentMaxYear) {
    filters.push({
      key: 'yearRange',
      label: `Years ${currentMinYear || '...'} - ${currentMaxYear || '...'}`,
      onClear: onClearYearRange,
    });
  }

  currentGenres.forEach((genre) => {
    const genreData = genres?.find(g => g.slug === genre);
    if (genreData) {
      filters.push({
        key: `genre-${genre}`,
        label: genreData.name,
        onClear: () => onToggleGenre(genre),
        isGenre: true
      });
    }
  });

  currentTags.forEach((tag) => {
    filters.push({
      key: `tag-${tag}`,
      label: tag.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      onClear: () => onToggleTag(tag),
      isGenre: true,
    });
  });

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 animate-fade-in">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mr-1">
        <span>Active:</span>
      </div>
      
      {filters.map((filter) => (
        <button
          key={filter.key}
          onClick={filter.onClear}
          className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all
            ${filter.isGenre 
              ? 'bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20' 
              : 'bg-dark-100 text-gray-300 border border-gray-700 hover:border-gray-600 hover:text-white'
            }`}
        >
          {filter.label}
          <X className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" />
        </button>
      ))}
      
      <button
        onClick={onClearAll}
        className="text-xs text-gray-500 hover:text-accent transition-colors ml-1"
      >
        Clear all
      </button>
    </div>
  );
}

ActiveFilterChips.propTypes = {
  currentTypes: PropTypes.string,
  currentStatuses: PropTypes.string,
  currentSeason: PropTypes.string,
  currentYear: PropTypes.string,
  currentMinRating: PropTypes.string,
  currentMaxRating: PropTypes.string,
  currentStudio: PropTypes.string,
  currentGenres: PropTypes.arrayOf(PropTypes.string).isRequired,
  currentTags: PropTypes.arrayOf(PropTypes.string).isRequired,
  currentSource: PropTypes.string,
  currentMinEpisodes: PropTypes.string,
  currentMaxEpisodes: PropTypes.string,
  currentMinDuration: PropTypes.string,
  currentMaxDuration: PropTypes.string,
  currentMinYear: PropTypes.string,
  currentMaxYear: PropTypes.string,
  typeOptions: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired
  })).isRequired,
  statusOptions: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired
  })).isRequired,
  seasonOptions: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired
  })).isRequired,
  sourceOptions: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired
  })).isRequired,
  studios: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired
  })),
  genres: PropTypes.arrayOf(PropTypes.shape({
    slug: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired
  })),
  onClearType: PropTypes.func.isRequired,
  onClearStatus: PropTypes.func.isRequired,
  onClearSeason: PropTypes.func.isRequired,
  onClearMinRating: PropTypes.func.isRequired,
  onClearMaxRating: PropTypes.func.isRequired,
  onClearStudio: PropTypes.func.isRequired,
  onToggleGenre: PropTypes.func.isRequired,
  onToggleTag: PropTypes.func.isRequired,
  onClearSource: PropTypes.func.isRequired,
  onClearMinEpisodes: PropTypes.func.isRequired,
  onClearMaxEpisodes: PropTypes.func.isRequired,
  onClearMinDuration: PropTypes.func.isRequired,
  onClearMaxDuration: PropTypes.func.isRequired,
  onClearYearRange: PropTypes.func.isRequired,
  onClearAll: PropTypes.func.isRequired,
  hasActiveFilters: PropTypes.bool.isRequired
};

ActiveFilterChips.defaultProps = {
  currentTypes: '',
  currentStatuses: '',
  currentSeason: '',
  currentYear: '',
  currentMinRating: '',
  currentMaxRating: '',
  currentStudio: '',
  currentTags: [],
  currentSource: '',
  currentMinEpisodes: '',
  currentMaxEpisodes: '',
  currentMinDuration: '',
  currentMaxDuration: '',
  currentMinYear: '',
  currentMaxYear: '',
  studios: [],
  genres: [],
  sourceOptions: [],
};
