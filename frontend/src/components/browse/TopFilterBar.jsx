import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Search, X, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const Pill = ({ active, label, onClick }) => (
    <button
        onClick={onClick}
        className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
            active 
            ? 'bg-accent text-white' 
            : 'bg-dark-200/50 text-gray-400 hover:bg-dark-200 hover:text-gray-300'
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
    hasActiveFilters
}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const localSearchInputRef = useRef(null);
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
            if (searchInput !== currentQuery) {
                const newParams = new URLSearchParams(searchParams);
                if (searchInput) {
                    newParams.set('q', searchInput);
                } else {
                    newParams.delete('q');
                }
                setSearchParams(newParams);
            }
        }, 300);
        return () => clearTimeout(timeout);
    }, [searchInput, currentQuery, searchParams, setSearchParams]);

    const handleSingleToggle = (key, value) => {
        const newParams = new URLSearchParams(searchParams);
        if (newParams.get(key) === value) {
            newParams.delete(key);
        } else {
            newParams.set(key, value);
        }
        setSearchParams(newParams);
    };

    const handleGenreToggle = (genreSlug) => {
        const newParams = new URLSearchParams(searchParams);
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
        newParams.set('year', newYear.toString());
        setSearchParams(newParams);
    };

    const clearSearch = () => {
        setSearchInput('');
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('q');
        setSearchParams(newParams);
    };

    // Use a subset of genres for the quick bar to avoid overwhelming it
    const quickGenres = !isGenresError && genres ? genres.slice(0, 8) : [];

    return (
        <div className="w-full mb-8">
            {/* Top Anchor Row */}
            <div className="flex items-center gap-3 w-full mb-4">
                
                {/* Search Input - Main Anchor */}
                <div className="flex-1 relative group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400 group-focus-within:text-accent transition-colors" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onFocus={() => { isSearchFocusedRef.current = true; }}
                        onBlur={() => { isSearchFocusedRef.current = false; }}
                        placeholder="Search anime..."
                        className="w-full rounded-xl bg-dark-200 pl-11 pr-10 py-3 text-base text-white outline-none transition-all placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:bg-dark-100"
                    />
                    {searchInput && (
                        <button
                            onClick={clearSearch}
                            className="flat-control absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-dark p-1 text-gray-400 hover:text-white"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Compact Year Stepper */}
                <div className="hidden sm:flex items-center bg-dark-200 rounded-xl p-1 h-[48px]">
                    <button 
                        onClick={() => handleYearStep(-1)}
                        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-100 transition-colors"
                        aria-label="Previous year"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="w-12 text-center text-sm font-bold text-gray-300">
                        {currentYear || 'Year'}
                    </span>
                    <button 
                        onClick={() => handleYearStep(1)}
                        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-100 transition-colors"
                        aria-label="Next year"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Advanced Filters Button */}
                <button
                    onClick={onOpenMobileFilters}
                    className="flex-shrink-0 relative w-[48px] h-[48px] flex items-center justify-center rounded-xl bg-dark-200 text-gray-400"
                    aria-label="Advanced Filters"
                >
                    <Filter className="w-[18px] h-[18px]" />
                    {hasActiveFilters && (
                        <span className="absolute top-3 right-3 w-2 h-2 bg-accent rounded-full border-2 border-dark-200" />
                    )}
                </button>
            </div>

            {/* Quick Filters Pill Row */}
            <div className="w-full overflow-x-auto custom-scrollbar pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
                <div className="flex items-center gap-4 min-w-max">
                    {/* Format Group */}
                    <div className="flex items-center gap-1.5 pr-4 border-r border-gray-800/50">
                        {typeOptions.map(type => (
                            <Pill 
                                key={type.value}
                                active={currentType === type.value}
                                label={type.label}
                                onClick={() => handleSingleToggle('type', type.value)}
                            />
                        ))}
                    </div>

                    {/* Season Group */}
                    <div className="flex items-center gap-1.5 pr-4 border-r border-gray-800/50">
                        {seasonOptions.map(season => (
                            <Pill 
                                key={season.value}
                                active={currentSeason === season.value}
                                label={season.label}
                                onClick={() => handleSingleToggle('season', season.value)}
                            />
                        ))}
                    </div>

                    {/* Genres Group */}
                    <div className="flex items-center gap-1.5">
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
            </div>
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
    hasActiveFilters: PropTypes.bool
};
