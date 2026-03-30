import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { ChevronDown, Search } from 'lucide-react';

const Pill = ({ active, label, onClick }) => (
  <button
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
      active
        ? 'bg-accent text-white'
        : 'bg-dark-200/60 text-gray-400 hover:bg-dark-200 hover:text-gray-200'
    }`}
  >
    {label}
  </button>
);

Pill.propTypes = {
  active: PropTypes.bool,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
};

const SectionHeader = ({ children }) => (
  <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.16em] mb-2">{children}</h3>
);

SectionHeader.propTypes = {
  children: PropTypes.node.isRequired,
};

const SelectField = ({ label, value, onChange, options, placeholder = 'Any' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      return undefined;
    }

    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      const target = event.target;
      const isTypingIntoField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTypingIntoField) return;

      if (event.key === 'Escape') {
        setIsOpen(false);
        return;
      }

      if (event.key === 'Backspace') {
        setSearchTerm((prev) => prev.slice(0, -1));
        return;
      }

      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        setSearchTerm((prev) => `${prev}${event.key}`.slice(-32));
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectedLabel = options.find((option) => option.value === (value || ''))?.label || placeholder;
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  return (
    <div>
      <SectionHeader>{label}</SectionHeader>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`w-full rounded-xl bg-dark-200/80 px-3.5 py-2 text-xs text-left text-gray-200 outline-none transition-colors border ${
            isOpen ? 'border-accent/50' : 'border-transparent'
          } hover:border-accent/40`}
        >
          <span className="block pr-6 truncate">{selectedLabel}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none transition-transform ${
              isOpen ? 'rotate-180 text-accent' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-700/70 bg-dark-300 shadow-[0_12px_28px_rgba(0,0,0,0.45)] overflow-hidden">
            <div className="max-h-64 overflow-y-auto py-1 custom-select-scroll">
              {!searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    !value ? 'bg-white/10 text-white' : 'text-gray-200 hover:bg-white/5'
                  }`}
                >
                  {placeholder}
                </button>
              )}
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      option.value === value
                        ? 'bg-accent/20 text-accent'
                        : 'text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    {option.label}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

SelectField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  placeholder: PropTypes.string,
};

const formatTag = (tag) =>
  tag
    .split(' ')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

const DualRangeFilter = ({
  label,
  min,
  max,
  step,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  format = (value) => value,
}) => {
  const parsedMin = Number.isFinite(Number(minValue)) ? Number(minValue) : min;
  const parsedMax = Number.isFinite(Number(maxValue)) ? Number(maxValue) : max;
  const minPercent = ((parsedMin - min) / (max - min)) * 100;
  const maxPercent = ((parsedMax - min) / (max - min)) * 100;

  return (
    <div className="rounded-xl bg-dark-200/40 p-3 border border-gray-800/60">
      <div className="flex items-center justify-between mb-2.5">
        <SectionHeader>{label}</SectionHeader>
        <div className="text-[11px] text-gray-400 font-semibold">
          {format(parsedMin)} - {format(parsedMax)}
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-dark-300/80">
        <div
          className="absolute h-full bg-accent rounded-full"
          style={{ left: `${minPercent}%`, width: `${maxPercent - minPercent}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={parsedMin}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (value <= parsedMax) onMinChange(value);
          }}
          className="absolute w-full -top-1.5 h-5 appearance-none bg-transparent pointer-events-auto cursor-pointer"
          style={{ zIndex: 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={parsedMax}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (value >= parsedMin) onMaxChange(value);
          }}
          className="absolute w-full -top-1.5 h-5 appearance-none bg-transparent pointer-events-auto cursor-pointer"
          style={{ zIndex: 4 }}
        />
      </div>
    </div>
  );
};

DualRangeFilter.propTypes = {
  label: PropTypes.string.isRequired,
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number.isRequired,
  minValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  maxValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onMinChange: PropTypes.func.isRequired,
  onMaxChange: PropTypes.func.isRequired,
  format: PropTypes.func,
};

export default function AdvancedFiltersPanel({
  isOpen,
  genres = [],
  studios = [],
  localFilters,
  onUpdateFilter,
  onToggleGenre,
  onToggleTag,
  statusOptions,
  yearOptions,
  sourceOptions,
  tagGroups,
  minYearBound,
  maxYearBound,
}) {
  const [showTagFilters, setShowTagFilters] = useState(true);
  const [tagSearch, setTagSearch] = useState('');
  const [showAllGenres, setShowAllGenres] = useState(false);

  const normalizedTagSearch = tagSearch.trim().toLowerCase();
  const selectedTags = localFilters.tags || [];

  const filteredGenres = useMemo(() => {
    if (!normalizedTagSearch) return genres;
    return genres.filter((genre) => genre.name.toLowerCase().includes(normalizedTagSearch));
  }, [genres, normalizedTagSearch]);

  const filteredTagGroups = useMemo(() => {
    return tagGroups
      .map((group) => ({
        ...group,
        tags: normalizedTagSearch
          ? group.tags.filter((tag) => tag.includes(normalizedTagSearch))
          : group.tags,
      }))
      .filter((group) => group.tags.length > 0);
  }, [tagGroups, normalizedTagSearch]);

  const displayedGenres = showAllGenres ? filteredGenres : filteredGenres.slice(0, 24);

  if (!isOpen) return null;

  return (
    <div className="w-full bg-dark-100 rounded-2xl border border-gray-800/60 mb-8 overflow-hidden animate-fade-in max-h-[82vh] sm:max-h-[80vh] flex flex-col">
      <div className="h-full min-h-0 p-4 sm:p-5 space-y-4 flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <SelectField
            label="Airing Status"
            value={localFilters.status}
            onChange={(value) => onUpdateFilter('status', value)}
            options={statusOptions}
          />
          <SelectField
            label="Studio"
            value={localFilters.studio}
            onChange={(value) => onUpdateFilter('studio', value)}
            options={(studios || []).map((studio) => ({
              value: String(studio.id),
              label: studio.name,
            }))}
            placeholder="All Studios"
          />
          <SelectField
            label="Source Material"
            value={localFilters.source}
            onChange={(value) => onUpdateFilter('source', value)}
            options={sourceOptions}
          />
          <SelectField
            label="Year"
            value={localFilters.year}
            onChange={(value) => onUpdateFilter('year', value)}
            options={(yearOptions || []).map((year) => ({ value: String(year), label: String(year) }))}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <DualRangeFilter
            label="Rating"
            min={0}
            max={10}
            step={0.5}
            minValue={localFilters.minRating || 0}
            maxValue={localFilters.maxRating || 10}
            onMinChange={(value) => onUpdateFilter('minRating', value === 0 ? '' : String(value))}
            onMaxChange={(value) => onUpdateFilter('maxRating', value === 10 ? '' : String(value))}
          />
          <DualRangeFilter
            label="Episodes"
            min={0}
            max={300}
            step={1}
            minValue={localFilters.minEpisodes || 0}
            maxValue={localFilters.maxEpisodes || 300}
            onMinChange={(value) => onUpdateFilter('minEpisodes', value === 0 ? '' : String(value))}
            onMaxChange={(value) => onUpdateFilter('maxEpisodes', value === 300 ? '' : String(value))}
          />
          <DualRangeFilter
            label="Duration (min)"
            min={0}
            max={180}
            step={1}
            minValue={localFilters.minDuration || 0}
            maxValue={localFilters.maxDuration || 180}
            onMinChange={(value) => onUpdateFilter('minDuration', value === 0 ? '' : String(value))}
            onMaxChange={(value) => onUpdateFilter('maxDuration', value === 180 ? '' : String(value))}
          />
          <DualRangeFilter
            label="Year Range"
            min={minYearBound}
            max={maxYearBound}
            step={1}
            minValue={localFilters.minYear || minYearBound}
            maxValue={localFilters.maxYear || maxYearBound}
            onMinChange={(value) =>
              onUpdateFilter('minYear', value === minYearBound ? '' : String(value))
            }
            onMaxChange={(value) =>
              onUpdateFilter('maxYear', value === maxYearBound ? '' : String(value))
            }
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Pill
            active={localFilters.genres.includes('hentai')}
            label="Adult (Hentai)"
            onClick={() => onToggleGenre('hentai')}
          />
          <Pill
            active={localFilters.genres.includes('ecchi')}
            label="Ecchi"
            onClick={() => onToggleGenre('ecchi')}
          />
          <Pill
            active={localFilters.tags?.includes('male protagonist')}
            label="Male Protagonist"
            onClick={() => onToggleTag('male protagonist')}
          />
          <Pill
            active={localFilters.tags?.includes('female protagonist')}
            label="Female Protagonist"
            onClick={() => onToggleTag('female protagonist')}
          />
        </div>

        <div className="rounded-2xl border border-gray-800/60 bg-dark-200/30 overflow-hidden flex flex-col min-h-0 flex-1">
          <button
            onClick={() => setShowTagFilters((prev) => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between text-left"
          >
            <span className="text-sm font-semibold text-gray-200">Advanced Genres & Tag Filters</span>
            <ChevronDown
              className={`w-4 h-4 text-gray-500 transition-transform ${showTagFilters ? '' : '-rotate-90'}`}
            />
          </button>

          {showTagFilters && (
            <div className="border-t border-gray-800/60 flex flex-col min-h-0 h-full">
              <div className="sticky top-0 z-10 px-4 pt-3 pb-2 bg-dark-100/95 backdrop-blur">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Filter tags and genres..."
                    className="w-full rounded-xl bg-dark-300/70 border border-gray-800 px-10 py-2 text-xs text-white outline-none focus:border-accent/50"
                  />
                </div>
              </div>

              <div className="tags-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4 pr-2">
                <div>
                  <SectionHeader>Genres</SectionHeader>
                  <div className="flex flex-wrap gap-1.5">
                    {displayedGenres.map((genre) => (
                      <Pill
                        key={genre.slug}
                        active={localFilters.genres.includes(genre.slug)}
                        label={genre.name}
                        onClick={() => onToggleGenre(genre.slug)}
                      />
                    ))}
                  </div>
                  {!normalizedTagSearch && genres.length > 24 && (
                    <button
                      onClick={() => setShowAllGenres((prev) => !prev)}
                      className="mt-3 text-xs font-semibold text-gray-500 hover:text-white uppercase tracking-wider"
                    >
                      {showAllGenres ? 'Show Less' : `Show All (${genres.length})`}
                    </button>
                  )}
                </div>

                {filteredTagGroups.map((group) => (
                  <div key={group.title}>
                    <SectionHeader>{group.title}</SectionHeader>
                    <div className="flex flex-wrap gap-1.5">
                      {group.tags.map((tag) => (
                        <Pill
                          key={tag}
                          active={selectedTags.includes(tag)}
                          label={formatTag(tag)}
                          onClick={() => onToggleTag(tag)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        input[type=range]::-webkit-slider-thumb {
          pointer-events: all;
          width: 16px;
          height: 16px;
          -webkit-appearance: none;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #7550e8;
          cursor: ew-resize;
        }
        input[type=range]::-moz-range-thumb {
          pointer-events: all;
          width: 16px;
          height: 16px;
          appearance: none;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #7550e8;
          cursor: ew-resize;
        }
        .tags-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .custom-select-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .tags-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 999px;
        }
        .custom-select-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.03);
          border-radius: 999px;
        }
        .tags-scroll::-webkit-scrollbar-thumb {
          background: rgba(117, 80, 232, 0.6);
          border-radius: 999px;
        }
        .custom-select-scroll::-webkit-scrollbar-thumb {
          background: rgba(117, 80, 232, 0.45);
          border-radius: 999px;
        }
        .tags-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(117, 80, 232, 0.85);
        }
        .custom-select-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(117, 80, 232, 0.7);
        }
      `}</style>
    </div>
  );
}

AdvancedFiltersPanel.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  genres: PropTypes.array,
  studios: PropTypes.array,
  localFilters: PropTypes.shape({
    genres: PropTypes.arrayOf(PropTypes.string),
    type: PropTypes.string,
    status: PropTypes.string,
    season: PropTypes.string,
    year: PropTypes.string,
    minRating: PropTypes.string,
    maxRating: PropTypes.string,
    studio: PropTypes.string,
    source: PropTypes.string,
    minEpisodes: PropTypes.string,
    maxEpisodes: PropTypes.string,
    minDuration: PropTypes.string,
    maxDuration: PropTypes.string,
    minYear: PropTypes.string,
    maxYear: PropTypes.string,
    tags: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  onUpdateFilter: PropTypes.func.isRequired,
  onToggleGenre: PropTypes.func.isRequired,
  onToggleTag: PropTypes.func.isRequired,
  statusOptions: PropTypes.array.isRequired,
  yearOptions: PropTypes.array.isRequired,
  sourceOptions: PropTypes.array.isRequired,
  tagGroups: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      tags: PropTypes.arrayOf(PropTypes.string).isRequired,
    })
  ).isRequired,
  minYearBound: PropTypes.number.isRequired,
  maxYearBound: PropTypes.number.isRequired,
};
