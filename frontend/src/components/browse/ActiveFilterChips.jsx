import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { formatSeasonLabel, stepSeason } from './browseFilterOptions';

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
  onStepSeason,
  onClearYear,
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
      onClear: onClearSeason,
      isSeason: true,
    });
  }

  // ‹ › beside the season chip step through seasons (P2-7).
  const canStepSeason = Boolean(onStepSeason && currentSeason && currentYear);
  const seasonStep = (direction) => {
    const next = canStepSeason ? stepSeason(currentSeason, currentYear, direction) : null;
    return next ? formatSeasonLabel(next.season, next.year) : '';
  };
  const stepButtonClass = 'flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.05] text-[var(--text-2)] hover:bg-white/[0.09] hover:text-[var(--text-1)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const renderSeasonStep = (direction) => {
    const target = seasonStep(direction);
    const Icon = direction < 0 ? ChevronLeft : ChevronRight;
    return (
      <button
        type="button"
        onClick={() => onStepSeason(direction)}
        disabled={!target}
        aria-label={target ? `${direction < 0 ? 'Previous' : 'Next'} season: ${target}` : `No ${direction < 0 ? 'previous' : 'next'} season`}
        className={stepButtonClass}
      >
        <Icon aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
    );
  };

  if (currentYear && !currentSeason && !currentMinYear && !currentMaxYear) {
    filters.push({
      key: 'year',
      label: `Year ${currentYear}`,
      onClear: onClearYear,
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
    <div className="mb-6 flex flex-wrap items-center gap-2 animate-fade-in">

      {filters.map((filter) => {
        const chip = (
          <button
            key={filter.key}
            type="button"
            onClick={filter.onClear}
            aria-label={`Remove ${filter.label}`}
            className="group flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.05] pl-3 pr-2 text-[13px] text-[var(--text-1)] transition-colors hover:bg-white/[0.09]"
          >
            {filter.label}
            <X aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-3)] transition-colors group-hover:text-[var(--text-1)]" />
          </button>
        );
        if (!filter.isSeason || !canStepSeason) return chip;
        return (
          <div key={filter.key} className="flex items-center gap-1">
            {renderSeasonStep(-1)}
            {chip}
            {renderSeasonStep(1)}
          </div>
        );
      })}
      
      <button
        type="button"
        onClick={onClearAll}
        className="text-link ml-1 !min-h-8 text-[13px]"
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
  onStepSeason: PropTypes.func,
  onClearYear: PropTypes.func.isRequired,
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
