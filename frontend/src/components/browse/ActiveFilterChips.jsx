import { X, SlidersHorizontal } from 'lucide-react';
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
  typeOptions,
  statusOptions,
  seasonOptions,
  studios,
  genres,
  onClearType,
  onClearStatus,
  onClearSeason,
  onClearMinRating,
  onClearMaxRating,
  onClearStudio,
  onToggleGenre,
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

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 animate-fade-in">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mr-1">
        <SlidersHorizontal className="w-3.5 h-3.5" />
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
  studios: [],
  genres: []
};