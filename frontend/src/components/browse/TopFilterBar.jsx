import { useState, useEffect, useRef } from 'react';
import useScrollFade from '../../hooks/useScrollFade';
import PropTypes from 'prop-types';
import { Search, X, Filter, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const SEARCH_DEBOUNCE_MS = 450;
const MIN_SEARCH_LENGTH = 2;

const Pill = ({ active, label, onClick }) => (
    <button
        onClick={onClick}
        aria-pressed={Boolean(active)}
        className={`min-h-10 px-3.5 rounded-lg text-sm whitespace-nowrap transition-colors flex-shrink-0 ${
            active
            ? 'bg-[var(--signature-soft)] text-[var(--signature)]'
            : 'text-[var(--text-2)] hover:bg-white/[0.05] hover:text-[var(--text-1)]'
        }`}
    >
        {label}
    </button>
);

Pill.propTypes = {
    active: PropTypes.bool,
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired
};

export default function TopFilterBar({
    genres,
    isGenresError,
    typeOptions,
    seasonOptions,
    yearOptions,
    searchInputRef,
    onOpenMobileFilters,
    hasActiveFilters,
    adultContentEnabled,
    onToggleAdultContent,
    isUpdatingAdultContent,
    canToggleAdultContent,
}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const localSearchInputRef = useRef(null);
    const chipRowRef = useScrollFade();
    const isSearchFocusedRef = useRef(false);
    const inputRef = searchInputRef || localSearchInputRef;
    const currentQuery = searchParams.get('q') || '';
    
    // Parse current states
    const currentGenres = searchParams.get('genre')?.split(',').filter(Boolean) || [];
    const currentType = searchParams.get('type') || '';
    const currentSeason = searchParams.get('season') || '';
    const currentYear = searchParams.get('year') || '';

    const [searchInput, setSearchInput] = useState(currentQuery);

    useEffect(() => {
        if (!isSearchFocusedRef.current) {
            setSearchInput(currentQuery);
        }
    }, [currentQuery]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            const normalizedInput = searchInput.trim();
            const nextQuery = normalizedInput.length >= MIN_SEARCH_LENGTH ? normalizedInput : '';
            if (nextQuery !== currentQuery) {
                const newParams = new URLSearchParams(searchParams);
                newParams.delete('exclude_ids');
                if (nextQuery) {
                    newParams.set('q', nextQuery);
                } else {
                    newParams.delete('q');
                }
                setSearchParams(newParams, { replace: true });
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timeout);
    }, [searchInput, currentQuery, searchParams, setSearchParams]);

    const handleSingleToggle = (key, value) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        if (newParams.get(key) === value) {
            newParams.delete(key);
            if (key === 'season') {
                newParams.delete('year');
            }
        } else {
            newParams.set(key, value);
            if (key === 'season' && !newParams.get('year')) {
                newParams.set('year', new Date().getFullYear().toString());
            }
        }
        setSearchParams(newParams);
    };

    const handleGenreToggle = (genreSlug) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        const updated = currentGenres.includes(genreSlug)
            ? currentGenres.filter(g => g !== genreSlug)
            : [...currentGenres, genreSlug];
            
        if (updated.length > 0) {
            newParams.set('genre', updated.join(','));
        } else {
            newParams.delete('genre');
        }
        setSearchParams(newParams);
    };

    const handleYearStep = (direction) => {
        const currentYearNum = currentYear ? parseInt(currentYear, 10) : new Date().getFullYear();
        let newYear = currentYearNum + direction;
        
        // Boundaries based on options
        const maxYear = yearOptions[0];
        const minYear = yearOptions[yearOptions.length - 1];
        
        if (newYear > maxYear) newYear = maxYear;
        if (newYear < minYear) newYear = minYear;

        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        newParams.set('year', newYear.toString());
        setSearchParams(newParams);
    };

    const clearSearch = () => {
        setSearchInput('');
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        newParams.delete('q');
        setSearchParams(newParams);
    };

    // Use a subset of genres for the quick bar to avoid overwhelming it
    // Every genre is one tap away; the 18+ ones come last.
    const ADULT_GENRES = new Set(['ecchi', 'hentai']);
    const quickGenres = !isGenresError && genres
        ? [...genres].sort((a, b) => Number(ADULT_GENRES.has(String(a.slug).toLowerCase())) - Number(ADULT_GENRES.has(String(b.slug).toLowerCase())))
        : [];

    return (
        <div className="w-full mb-8">
            {/* Top Anchor Row */}
            <div className="flex items-center gap-3 w-full mb-4">
                
                {/* Search Input - Main Anchor */}
                <div className="flex-1 relative group">
                    <Search aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400 group-focus-within:text-accent transition-colors" />
                    <input
                        ref={inputRef}
                        type="search"
                        aria-label="Search anime"
                        enterKeyHint="search"
                        autoComplete="off"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onFocus={() => { isSearchFocusedRef.current = true; }}
                        onBlur={() => { isSearchFocusedRef.current = false; }}
                        placeholder="Search anime..."
                        className="w-full rounded-xl bg-dark-200 pl-11 pr-10 py-3 text-base text-white transition-colors placeholder:text-gray-500 focus:bg-dark-100 [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {searchInput && (
                        <button
                            type="button"
                            onClick={clearSearch}
                            aria-label="Clear search"
                            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-dark p-1 text-gray-400 hover:text-white"
                        >
                            <X aria-hidden="true" className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Compact Year Stepper */}
                <div className="hidden sm:flex items-center bg-dark-200 rounded-xl p-1 h-[48px]">
                    <button
                        type="button"
                        onClick={() => handleYearStep(-1)}
                        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-100 transition-colors"
                        aria-label="Previous year"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="w-[4.5rem] text-center text-sm font-semibold text-gray-300 tabular" aria-live="polite">
                        {currentYear || 'Any year'}
                    </span>
                    <button
                        type="button"
                        onClick={() => handleYearStep(1)}
                        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-100 transition-colors"
                        aria-label="Next year"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Adult Content Toggle (members only; guests would see a dead control) */}
                {canToggleAdultContent && (
                <button
                    type="button"
                    onClick={onToggleAdultContent}
                    disabled={isUpdatingAdultContent || !canToggleAdultContent}
                    className={`flex flex-shrink-0 items-center justify-center w-[48px] h-[48px] rounded-xl transition-colors ${
                        adultContentEnabled
                            ? 'bg-accent/20 text-accent'
                            : 'bg-dark-200 text-gray-400 hover:text-white'
                    } ${isUpdatingAdultContent || !canToggleAdultContent ? 'opacity-60 cursor-not-allowed' : ''}`}
                    aria-label={
                        adultContentEnabled ? 'Hide explicit hentai content' : 'Show explicit hentai content'
                    }
                    title={
                        !canToggleAdultContent
                            ? 'Log in to change explicit content visibility'
                            : adultContentEnabled
                                ? 'Explicit hentai: visible'
                                : 'Explicit hentai: hidden'
                    }
                >
                    {adultContentEnabled ? <Eye aria-hidden="true" className="w-[18px] h-[18px]" /> : <EyeOff aria-hidden="true" className="w-[18px] h-[18px]" />}
                </button>
                )}

                {/* Advanced Filters Button */}
                <button
                    onClick={onOpenMobileFilters}
                    className="flex-shrink-0 relative w-[48px] h-[48px] flex items-center justify-center rounded-xl bg-dark-200 text-gray-400"
                    aria-label="Advanced Filters"
                >
                    <Filter className="w-[18px] h-[18px]" />
                    {hasActiveFilters && (
                        <span className="absolute top-3 right-3 w-2 h-2 bg-accent-dark rounded-full border-2 border-dark-200" />
                    )}
                </button>
            </div>

            {/* Format and season: two short rows that wrap, never scroll (B2).
                On phones they live in the filters sheet so the posters come first. */}
            <div className="hidden flex-wrap items-center gap-x-5 gap-y-1 sm:flex">
                <div role="group" aria-label="Format" className="flex flex-wrap items-center gap-1">
                    {typeOptions.map(type => (
                        <Pill
                            key={type.value}
                            active={currentType === type.value}
                            label={type.label}
                            onClick={() => handleSingleToggle('type', type.value)}
                        />
                    ))}
                </div>
                <div role="group" aria-label="Season" className="flex flex-wrap items-center gap-1">
                    {seasonOptions.map(season => (
                        <Pill
                            key={season.value}
                            active={currentSeason === season.value}
                            label={season.label}
                            onClick={() => handleSingleToggle('season', season.value)}
                        />
                    ))}
                </div>
            </div>

            {/* Genres: one scrolling row with an edge fade where it continues. */}
            {quickGenres.length > 0 && (
                <div ref={chipRowRef} role="group" aria-label="Genres" className="scroll-fade mt-1 hidden overflow-x-auto scrollbar-hide sm:block">
                    <div className="flex min-w-max items-center gap-1">
                        {quickGenres.map(genre => (
                            <Pill
                                key={genre.slug}
                                active={currentGenres.includes(genre.slug)}
                                label={genre.name}
                                onClick={() => handleGenreToggle(genre.slug)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

TopFilterBar.propTypes = {
    genres: PropTypes.array,
    isGenresError: PropTypes.bool,
    typeOptions: PropTypes.array,
    statusOptions: PropTypes.array,
    seasonOptions: PropTypes.array,
    yearOptions: PropTypes.array,
    searchInputRef: PropTypes.oneOfType([
        PropTypes.func,
        PropTypes.shape({ current: PropTypes.any })
    ]),
    onOpenMobileFilters: PropTypes.func,
    hasActiveFilters: PropTypes.bool,
    adultContentEnabled: PropTypes.bool,
    onToggleAdultContent: PropTypes.func,
    isUpdatingAdultContent: PropTypes.bool,
    canToggleAdultContent: PropTypes.bool,
};
