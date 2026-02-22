import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Tv, ChevronRight, Calendar, Star, Building2, Filter } from 'lucide-react';
import PropTypes from 'prop-types';

const FilterSection = ({ icon: Icon, title, section, count, collapsed, onToggle, children, isMobile }) => (
  <div className="border-b border-gray-800/50 last:border-b-0 pb-4 mb-4">
    <button
      onClick={() => onToggle(section)}
      className="w-full flex items-center justify-between text-sm font-semibold text-white mb-3 hover:text-accent transition-colors group"
      aria-expanded={!collapsed}
      aria-controls={`${section}-content`}
    >
      <span className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-accent/70" />
        <span className="tracking-wide">{title}</span>
        {count > 0 && (
          <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </span>
      {collapsed ? (
        <ChevronDown className="w-4 h-4 text-gray-500 group-hover:text-accent transition-colors" />
      ) : (
        <ChevronUp className="w-4 h-4 text-gray-500 group-hover:text-accent transition-colors" />
      )}
    </button>

    {!collapsed && (
      <div
        id={`${section}-content`}
        className={`animate-fade-in ${isMobile ? '' : ''}`}
      >
        {children}
      </div>
    )}
  </div>
);

FilterSection.propTypes = {
  icon: PropTypes.elementType.isRequired,
  title: PropTypes.string.isRequired,
  section: PropTypes.string.isRequired,
  count: PropTypes.number,
  collapsed: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  isMobile: PropTypes.bool
};

FilterSection.defaultProps = {
  count: 0,
  isMobile: false
};

export default function FilterSidebar({
  isMobile = false,
  genres = [],
  studios = [],
  isGenresError = false,
  isStudiosError = false,
  localFilters,
  collapsedSections,
  onToggleSection,
  onUpdateFilter,
  onToggleGenre,
  hasUnappliedChanges,
  onApplyFilters,
  onResetFilters,
  typeOptions,
  statusOptions,
  seasonOptions,
  yearOptions
}) {
  const [genreSearch, setGenreSearch] = useState('');
  const [showAllGenres, setShowAllGenres] = useState(false);

  const filteredGenres = genres.filter(g =>
    g.name.toLowerCase().includes(genreSearch.toLowerCase())
  );
  const displayedGenres = showAllGenres ? filteredGenres : filteredGenres.slice(0, 12);

  const RadioOption = useCallback(({
    label,
    checked,
    onChange,
    value
  }) => (
    <label
      className="flex items-center gap-3 cursor-pointer group py-1.5"
      role="radio"
      aria-checked={checked}
    >
      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors flex-shrink-0 ${checked
          ? 'border-accent bg-accent'
          : 'border-gray-600 bg-dark-100 group-hover:border-gray-500'
        }`}>
        {checked && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
      <input
        type="radio"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className={`text-sm transition-colors ${checked
          ? 'text-white font-medium'
          : 'text-gray-400 group-hover:text-white'
        }`}>
        {label}
      </span>
    </label>
  ), []);

  RadioOption.propTypes = {
    label: PropTypes.string.isRequired,
    checked: PropTypes.bool.isRequired,
    onChange: PropTypes.func.isRequired,
    value: PropTypes.string.isRequired
  };

  return (
    <div className={`${isMobile ? '' : 'space-y-1'}`}>
      {/* Format/Type */}
      <FilterSection
        icon={Tv}
        title="Format"
        section="format"
        count={localFilters.type ? 1 : 0}
        collapsed={collapsedSections.format}
        onToggle={onToggleSection}
        isMobile={isMobile}
      >
        <div className="space-y-0.5">
          <RadioOption
            label="Any Format"
            value=""
            checked={!localFilters.type}
            onChange={() => onUpdateFilter('type', '')}
          />
          {typeOptions.map((type) => (
            <RadioOption
              key={type.value}
              label={type.label}
              value={type.value}
              checked={localFilters.type === type.value}
              onChange={() => onUpdateFilter('type', type.value)}
            />
          ))}
        </div>
      </FilterSection>

      {/* Status */}
      <FilterSection
        icon={ChevronRight}
        title="Status"
        section="status"
        count={localFilters.status ? 1 : 0}
        collapsed={collapsedSections.status}
        onToggle={onToggleSection}
        isMobile={isMobile}
      >
        <div className="space-y-0.5">
          <RadioOption
            label="Any Status"
            value=""
            checked={!localFilters.status}
            onChange={() => onUpdateFilter('status', '')}
          />
          {statusOptions.map((status) => (
            <RadioOption
              key={status.value}
              label={status.label}
              value={status.value}
              checked={localFilters.status === status.value}
              onChange={() => onUpdateFilter('status', status.value)}
            />
          ))}
        </div>
      </FilterSection>

      {/* Season & Year */}
      <FilterSection
        icon={Calendar}
        title="Season"
        section="season"
        count={(localFilters.season || localFilters.year) ? 1 : 0}
        collapsed={collapsedSections.season}
        onToggle={onToggleSection}
        isMobile={isMobile}
      >
        <div className="grid grid-cols-2 gap-2">
          <select
            value={localFilters.season}
            onChange={(e) => onUpdateFilter('season', e.target.value)}
            className="bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors"
          >
            <option value="">Any Season</option>
            {seasonOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label.split(' ')[0]}</option>
            ))}
          </select>
          <select
            value={localFilters.year}
            onChange={(e) => onUpdateFilter('year', e.target.value)}
            className="bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors"
          >
            <option value="">Any Year</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </FilterSection>

      {/* Rating Range */}
      <FilterSection
        icon={Star}
        title="Rating"
        section="rating"
        count={(localFilters.minRating || localFilters.maxRating) ? 1 : 0}
        collapsed={collapsedSections.rating}
        onToggle={onToggleSection}
        isMobile={isMobile}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="10"
              step="0.5"
              placeholder="Min"
              value={localFilters.minRating}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  onUpdateFilter('minRating', '');
                  return;
                }
                const numValue = parseFloat(value);
                if (isNaN(numValue)) return;
                const clampedValue = Math.max(0, Math.min(10, numValue));
                onUpdateFilter('minRating', clampedValue.toString());
              }}
              className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors"
            />
            <span className="text-gray-500">-</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.5"
              placeholder="Max"
              value={localFilters.maxRating}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  onUpdateFilter('maxRating', '');
                  return;
                }
                const numValue = parseFloat(value);
                if (isNaN(numValue)) return;
                const clampedValue = Math.max(0, Math.min(10, numValue));
                onUpdateFilter('maxRating', clampedValue.toString());
              }}
              className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors"
            />
          </div>
          {localFilters.minRating && localFilters.maxRating &&
            parseFloat(localFilters.minRating) > parseFloat(localFilters.maxRating) && (
              <p className="text-xs text-red-400">Min rating cannot be greater than max</p>
            )}
        </div>
      </FilterSection>

      {/* Studios */}
      <FilterSection
        icon={Building2}
        title="Studio"
        section="studio"
        count={localFilters.studio ? 1 : 0}
        collapsed={collapsedSections.studio}
        onToggle={onToggleSection}
        isMobile={isMobile}
      >
        {isStudiosError ? (
          <p className="text-xs text-red-400 p-2 text-center bg-red-400/10 rounded-lg">
            Failed to load studios
          </p>
        ) : (
          <select
            value={localFilters.studio}
            onChange={(e) => onUpdateFilter('studio', e.target.value)}
            className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors"
          >
            <option value="">All Studios</option>
            {studios?.map((studio) => (
              <option key={studio.id} value={studio.id}>{studio.name}</option>
            ))}
          </select>
        )}
      </FilterSection>

      {/* Genres */}
      <FilterSection
        icon={Filter}
        title="Genres"
        section="genres"
        count={localFilters.genres.length}
        collapsed={collapsedSections.genres}
        onToggle={onToggleSection}
        isMobile={isMobile}
      >
        {isGenresError ? (
          <p className="text-xs text-red-400 p-2 text-center bg-red-400/10 rounded-lg">
            Failed to load genres
          </p>
        ) : (
          <div className="space-y-3">
            {genres?.length > 12 && (
              <input
                type="text"
                placeholder="Search genres..."
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
                className="w-full bg-dark-100 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors placeholder:text-gray-600"
              />
            )}
            <div className="flex flex-wrap gap-2 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
              {displayedGenres.map((genre) => {
                const isSelected = localFilters.genres.includes(genre.slug);
                return (
                  <button
                    key={genre.id}
                    onClick={() => onToggleGenre(genre.slug)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200
                      ${isSelected
                        ? 'bg-accent text-white shadow-sm shadow-accent/20'
                        : 'bg-dark-100 text-gray-400 border border-gray-700 hover:border-accent/50 hover:text-white'
                      }`}
                  >
                    {genre.name}
                  </button>
                );
              })}
            </div>

            {filteredGenres.length > 12 && !genreSearch && (
              <button
                onClick={() => setShowAllGenres(!showAllGenres)}
                className="text-xs text-accent hover:text-accent-light transition-colors font-medium"
              >
                {showAllGenres ? 'Show Less' : `Show All (${filteredGenres.length})`}
              </button>
            )}
          </div>
        )}
      </FilterSection>

      {/* Apply/Reset Buttons */}
      {hasUnappliedChanges && (
        <div className={`space-y-2 animate-fade-in mt-6 ${isMobile ? 'pt-2 pb-4 border-t border-gray-800' : ''}`}>
          {!isMobile && (
            <button
              onClick={onApplyFilters}
              className="w-full py-2.5 text-sm font-bold text-white bg-accent hover:bg-accent-dark rounded-xl transition-colors shadow-lg shadow-accent/20"
            >
              Apply Filters
            </button>
          )}
          <button
            onClick={onResetFilters}
            className="w-full py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Reset {isMobile ? 'Changes' : 'Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

FilterSidebar.propTypes = {
  isMobile: PropTypes.bool,
  genres: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired,
    slug: PropTypes.string.isRequired
  })),
  studios: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired
  })),
  isGenresError: PropTypes.bool,
  isStudiosError: PropTypes.bool,
  localFilters: PropTypes.shape({
    genres: PropTypes.arrayOf(PropTypes.string).isRequired,
    type: PropTypes.string.isRequired,
    status: PropTypes.string.isRequired,
    season: PropTypes.string.isRequired,
    year: PropTypes.string.isRequired,
    minRating: PropTypes.string.isRequired,
    maxRating: PropTypes.string.isRequired,
    studio: PropTypes.string.isRequired
  }).isRequired,
  collapsedSections: PropTypes.objectOf(PropTypes.bool).isRequired,
  onToggleSection: PropTypes.func.isRequired,
  onUpdateFilter: PropTypes.func.isRequired,
  onToggleGenre: PropTypes.func.isRequired,
  hasUnappliedChanges: PropTypes.bool.isRequired,
  onApplyFilters: PropTypes.func.isRequired,
  onResetFilters: PropTypes.func.isRequired,
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
  yearOptions: PropTypes.arrayOf(PropTypes.number).isRequired
};

FilterSidebar.defaultProps = {
  isMobile: false,
  genres: [],
  studios: [],
  isGenresError: false,
  isStudiosError: false
};