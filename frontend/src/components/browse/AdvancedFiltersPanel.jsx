import { useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Check, ChevronDown, Search, X } from 'lucide-react';

const ADULT_GENRES = new Set(['ecchi', 'hentai']);

/** "female protagonist" → "Female protagonist" (sentence case). */
const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

/** "Theme / Fantasy" → "Fantasy", "Cast / Main Cast" → "Main cast". */
const groupLabel = (title) => sentence((title.split('/').pop() || title).trim().toLowerCase().replace(/^sci fi$/, 'sci-fi'));

const Label = ({ children, htmlFor, id }) => (
  <label id={id} htmlFor={htmlFor} className="mb-2 block text-sm text-[var(--text-3)]">{children}</label>
);

Label.propTypes = { children: PropTypes.node.isRequired, htmlFor: PropTypes.string, id: PropTypes.string };

/** A soft chip: tags, genres, format and season on phones. */
const Chip = ({ active, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={Boolean(active)}
    className={`h-9 whitespace-nowrap rounded-lg px-3 text-sm transition-colors duration-150 ${active
      ? 'bg-[var(--signature-soft)] font-medium text-[var(--signature)]'
      : 'bg-white/[0.04] text-[var(--text-2)] hover:bg-white/[0.08] hover:text-[var(--text-1)]'}`}
  >
    {label}
  </button>
);

Chip.propTypes = { active: PropTypes.bool, label: PropTypes.string.isRequired, onClick: PropTypes.func.isRequired };

/** A labelled single choice with "Any"; type to jump in long lists (studios). */
function SelectField({ label, value, onChange, options, anyLabel = 'Any' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((option) => option.value === (value || ''));
  const shown = query
    ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const searchable = options.length > 12;
  const row = 'flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 hover:bg-white/[0.06]';

  return (
    <div ref={ref} className="relative">
      <Label id={labelId}>{label}</Label>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-labelledby={labelId}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-sm transition-colors duration-150 ${value
          ? 'bg-[var(--signature-soft)] text-[var(--signature)]'
          : 'bg-white/[0.05] text-[var(--text-2)] hover:bg-white/[0.08] hover:text-[var(--text-1)]'}`}
      >
        <span className="truncate">{selected?.label || anyLabel}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="popover-in absolute left-0 right-0 top-full z-40 mt-2 rounded-xl bg-[var(--ink-3)] p-1.5 shadow-[var(--shadow-pop)]">
          {searchable && (
            <div className="relative mb-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Find a ${label.toLowerCase()}`}
                aria-label={`Find a ${label.toLowerCase()}`}
                className="h-9 w-full rounded-lg bg-white/[0.05] pl-9 pr-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)]"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {!query && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }} className={`${row} ${!value ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
                {anyLabel}
                {!value && <Check aria-hidden="true" className="h-4 w-4 text-[var(--signature)]" />}
              </button>
            )}
            {shown.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`${row} ${option.value === value ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--signature)]" />}
              </button>
            ))}
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-[var(--text-3)]">No matches</p>}
          </div>
        </div>
      )}
    </div>
  );
}

SelectField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })).isRequired,
  anyLabel: PropTypes.string,
};

/** Two thumbs on one quiet track; reads "Any" until moved. */
function RangeField({ label, min, max, step, minValue, maxValue, onMinChange, onMaxChange, unit = '' }) {
  const low = Number.isFinite(Number(minValue)) && minValue !== '' ? Number(minValue) : min;
  const high = Number.isFinite(Number(maxValue)) && maxValue !== '' ? Number(maxValue) : max;
  const lowPct = ((low - min) / (max - min)) * 100;
  const highPct = ((high - min) / (max - min)) * 100;
  const isAny = low === min && high === max;
  const valueText = isAny
    ? 'Any'
    : low === min ? `Up to ${high}${unit}` : high === max ? `${low}${unit} and up` : `${low}–${high}${unit}`;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-sm text-[var(--text-3)]">{label}</span>
        <span className={`text-sm tabular ${isAny ? 'text-[var(--text-3)]' : 'font-medium text-[var(--text-1)]'}`}>{valueText}</span>
      </div>
      <div className="range-field relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/[0.08]" />
        <div
          className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-full ${isAny ? 'bg-white/[0.18]' : 'bg-[var(--signature)]'}`}
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
        />
        <input
          type="range" min={min} max={max} step={step} value={low}
          aria-label={`${label}, lowest`}
          onChange={(event) => { const v = Number(event.target.value); if (v <= high) onMinChange(v); }}
          className="absolute inset-0 w-full"
        />
        <input
          type="range" min={min} max={max} step={step} value={high}
          aria-label={`${label}, highest`}
          onChange={(event) => { const v = Number(event.target.value); if (v >= low) onMaxChange(v); }}
          className="absolute inset-0 w-full"
        />
      </div>
    </div>
  );
}

RangeField.propTypes = {
  label: PropTypes.string.isRequired,
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number.isRequired,
  minValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  maxValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onMinChange: PropTypes.func.isRequired,
  onMaxChange: PropTypes.func.isRequired,
  unit: PropTypes.string,
};

/**
 * "More filters" (B3): everything the one-row toolbar leaves out, on one
 * quiet panel. Desktop: inline under the toolbar. Phones: a full-screen sheet
 * that also carries format, season, year and genres (hidden from the phone
 * toolbar), with "Show results" at the bottom. Every change applies at once.
 */
export default function AdvancedFiltersPanel({
  isOpen,
  genres = [],
  studios = [],
  localFilters,
  onUpdateFilter,
  onToggleGenre,
  onToggleTag,
  typeOptions = [],
  seasonOptions = [],
  statusOptions,
  yearOptions,
  sourceOptions,
  tagGroups,
  minYearBound,
  maxYearBound,
  adultContentEnabled = false,
  hasActiveFilters = false,
  onClearAll,
  onClose = () => {},
}) {
  const [tagQuery, setTagQuery] = useState('');
  const selectedTags = localFilters.tags || [];
  const query = tagQuery.trim().toLowerCase();

  const groups = useMemo(() => tagGroups
    .map((group) => ({ ...group, tags: query ? group.tags.filter((tag) => tag.includes(query)) : group.tags }))
    .filter((group) => group.tags.length > 0), [tagGroups, query]);

  const visibleGenres = useMemo(() => (genres || []).filter((genre) => {
    const adult = ADULT_GENRES.has(String(genre.slug).toLowerCase());
    return !adult || adultContentEnabled || localFilters.genres.includes(genre.slug);
  }), [genres, adultContentEnabled, localFilters.genres]);

  // Phones: the sheet covers the page, so the page stops scrolling under it.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(max-width: 639px)').matches) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const section = 'mt-7 first:mt-0';

  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-[var(--ink-0)] sm:static sm:z-auto sm:mb-6 sm:block sm:bg-transparent">
      <div
        role="region"
        aria-label="More filters"
        className="popover-in flex min-h-0 flex-1 flex-col sm:block sm:rounded-[var(--radius-lg)] sm:bg-[var(--ink-1)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-6 sm:pt-5">
          <h2 className="text-[17px] font-semibold text-[var(--text-1)]">
            <span className="sm:hidden">Filters</span>
            <span className="hidden sm:inline">More filters</span>
          </h2>
          <div className="flex items-center gap-1">
            {hasActiveFilters && onClearAll && (
              <button type="button" onClick={onClearAll} className="text-link px-2 text-sm">Clear all</button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-1)]"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 sm:overflow-visible sm:px-6">
          {/* Phones only: what the desktop toolbar shows as menus. */}
          <div className="sm:hidden">
            <div className={section}>
              <Label>Format</Label>
              <div className="flex flex-wrap gap-1.5">
                {typeOptions.map((option) => (
                  <Chip key={option.value} label={option.label} active={localFilters.type === option.value}
                    onClick={() => onUpdateFilter('type', localFilters.type === option.value ? '' : option.value)} />
                ))}
              </div>
            </div>
            <div className={section}>
              <Label>Season</Label>
              <div className="flex flex-wrap gap-1.5">
                {seasonOptions.map((option) => (
                  <Chip key={option.value} label={option.label} active={localFilters.season === option.value}
                    onClick={() => onUpdateFilter('season', localFilters.season === option.value ? '' : option.value)} />
                ))}
              </div>
            </div>
            <div className={section}>
              <SelectField
                label="Year"
                value={localFilters.year}
                onChange={(value) => onUpdateFilter('year', value)}
                options={(yearOptions || []).map((year) => ({ value: String(year), label: String(year) }))}
              />
            </div>
            {visibleGenres.length > 0 && (
              <div className={section}>
                <Label>Genres</Label>
                <div className="flex flex-wrap gap-1.5">
                  {visibleGenres.map((genre) => (
                    <Chip key={genre.slug} label={genre.name} active={localFilters.genres.includes(genre.slug)}
                      onClick={() => onToggleGenre(genre.slug)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={`${section} grid gap-4 sm:mt-1 sm:grid-cols-3`}>
            <SelectField label="Status" value={localFilters.status} onChange={(value) => onUpdateFilter('status', value)} options={statusOptions} />
            <SelectField
              label="Studio"
              value={localFilters.studio}
              onChange={(value) => onUpdateFilter('studio', value)}
              options={(studios || []).map((studio) => ({ value: String(studio.id), label: studio.name }))}
            />
            <SelectField label="Source" value={localFilters.source} onChange={(value) => onUpdateFilter('source', value)} options={sourceOptions} />
          </div>

          <div className={`${section} grid gap-x-10 gap-y-6 sm:grid-cols-2`}>
            <RangeField
              label="Score" min={0} max={10} step={0.5}
              minValue={localFilters.minRating} maxValue={localFilters.maxRating}
              onMinChange={(v) => onUpdateFilter('minRating', v === 0 ? '' : String(v))}
              onMaxChange={(v) => onUpdateFilter('maxRating', v === 10 ? '' : String(v))}
            />
            <RangeField
              label="Episodes" min={0} max={300} step={1}
              minValue={localFilters.minEpisodes} maxValue={localFilters.maxEpisodes}
              onMinChange={(v) => onUpdateFilter('minEpisodes', v === 0 ? '' : String(v))}
              onMaxChange={(v) => onUpdateFilter('maxEpisodes', v === 300 ? '' : String(v))}
            />
            <RangeField
              label="Episode length" min={0} max={180} step={1} unit=" min"
              minValue={localFilters.minDuration} maxValue={localFilters.maxDuration}
              onMinChange={(v) => onUpdateFilter('minDuration', v === 0 ? '' : String(v))}
              onMaxChange={(v) => onUpdateFilter('maxDuration', v === 180 ? '' : String(v))}
            />
            <RangeField
              label="Years" min={minYearBound} max={maxYearBound} step={1}
              minValue={localFilters.minYear} maxValue={localFilters.maxYear}
              onMinChange={(v) => onUpdateFilter('minYear', v === minYearBound ? '' : String(v))}
              onMaxChange={(v) => onUpdateFilter('maxYear', v === maxYearBound ? '' : String(v))}
            />
          </div>

          <div className={section}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-[var(--text-3)]">Tags</span>
              <div className="relative w-full sm:w-64">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" />
                <input
                  type="search"
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  placeholder="Find a tag"
                  aria-label="Find a tag"
                  className="h-9 w-full rounded-lg bg-white/[0.05] pl-9 pr-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] [&::-webkit-search-cancel-button]:appearance-none"
                />
              </div>
            </div>
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.title} className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-start">
                  <span className="text-sm text-[var(--text-2)] sm:pt-2">{groupLabel(group.title)}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {group.tags.map((tag) => (
                      <Chip key={tag} label={sentence(tag)} active={selectedTags.includes(tag)} onClick={() => onToggleTag(tag)} />
                    ))}
                  </div>
                </div>
              ))}
              {groups.length === 0 && <p className="text-sm text-[var(--text-3)]">No tag matches “{tagQuery}”.</p>}
            </div>
          </div>
        </div>

        {/* Phones: one clear way back to the results. */}
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
          <button type="button" onClick={onClose} className="btn-primary w-full">Show results</button>
        </div>
      </div>
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
  typeOptions: PropTypes.array,
  seasonOptions: PropTypes.array,
  statusOptions: PropTypes.array.isRequired,
  yearOptions: PropTypes.array.isRequired,
  sourceOptions: PropTypes.array.isRequired,
  tagGroups: PropTypes.arrayOf(PropTypes.shape({
    title: PropTypes.string.isRequired,
    tags: PropTypes.arrayOf(PropTypes.string).isRequired,
  })).isRequired,
  minYearBound: PropTypes.number.isRequired,
  maxYearBound: PropTypes.number.isRequired,
  adultContentEnabled: PropTypes.bool,
  hasActiveFilters: PropTypes.bool,
  onClearAll: PropTypes.func,
  onClose: PropTypes.func,
};
