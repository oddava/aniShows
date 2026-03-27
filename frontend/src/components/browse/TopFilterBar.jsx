import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Search, X, Filter } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

export default function TopFilterBar({
    genres,
    isGenresError,
    typeOptions,
    statusOptions,
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

    const [searchInput, setSearchInput] = useState(currentQuery);

    // Only pull from the URL when the user is not actively editing the field.
    useEffect(() => {
        if (!isSearchFocusedRef.current) {
            setSearchInput(currentQuery);
        }
    }, [currentQuery]);

    // Debounce search
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (searchInput !== currentQuery) {
                const newParams = new URLSearchParams(searchParams);
                if (searchInput) {
                    newParams.set('q', searchInput);
                    // Clear other filters when searching if preferred? No, let's keep them
                } else {
                    newParams.delete('q');
                }
                setSearchParams(newParams);
            }
        }, 300);
        return () => clearTimeout(timeout);
    }, [searchInput, currentQuery, searchParams, setSearchParams]);

    const handleSelectChange = (key, value) => {
        const newParams = new URLSearchParams(searchParams);
        if (value) {
            newParams.set(key, value);
        } else {
            newParams.delete(key);
        }
        setSearchParams(newParams);
    };

    const clearSearch = () => {
        setSearchInput('');
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('q');
        setSearchParams(newParams);
    };

    return (
        <div className="w-full mb-8 md:mb-12">
            <div className="flex flex-col lg:flex-row gap-4">
                
                {/* Search Input - Taking more space */}
                <div className="flex-1 lg:max-w-xs relative group">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Search</label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-accent transition-colors" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onFocus={() => {
                                isSearchFocusedRef.current = true;
                            }}
                            onBlur={() => {
                                isSearchFocusedRef.current = false;
                            }}
                            placeholder="Find anime..."
                            className="w-full bg-dark-200 border border-gray-700/50 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white focus:outline-none focus:border-accent hover:border-gray-600 transition-colors placeholder:text-gray-600 shadow-inner"
                        />
                        {searchInput && (
                            <button
                                onClick={clearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white bg-dark p-0.5 rounded-full z-10"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Filters Grid */}
                <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3">
                    
                    {/* Genres Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Genres</label>
                        <select
                            value={searchParams.get('genre') || ''}
                            onChange={(e) => handleSelectChange('genre', e.target.value)}
                            className="w-full bg-dark-200 border border-gray-700/50 rounded-xl px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors appearance-none shadow-inner truncate"
                        >
                            <option value="">Any</option>
                            {!isGenresError && genres?.map((g) => (
                                <option key={g.id} value={g.slug}>{g.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Year Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Year</label>
                        <select
                            value={searchParams.get('year') || ''}
                            onChange={(e) => handleSelectChange('year', e.target.value)}
                            className="w-full bg-dark-200 border border-gray-700/50 rounded-xl px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors appearance-none shadow-inner"
                        >
                            <option value="">Any</option>
                            {yearOptions.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>

                    {/* Season Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Season</label>
                        <select
                            value={searchParams.get('season') || ''}
                            onChange={(e) => handleSelectChange('season', e.target.value)}
                            className="w-full bg-dark-200 border border-gray-700/50 rounded-xl px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors appearance-none shadow-inner capitalize"
                        >
                            <option value="">Any</option>
                            {seasonOptions.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Format Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Format</label>
                        <select
                            value={searchParams.get('type') || ''}
                            onChange={(e) => handleSelectChange('type', e.target.value)}
                            className="w-full bg-dark-200 border border-gray-700/50 rounded-xl px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors appearance-none shadow-inner"
                        >
                            <option value="">Any</option>
                            {typeOptions.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Status Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Airing Status</label>
                        <select
                            value={searchParams.get('status') || ''}
                            onChange={(e) => handleSelectChange('status', e.target.value)}
                            className="w-full bg-dark-200 border border-gray-700/50 rounded-xl px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-accent hover:border-gray-600 transition-colors appearance-none shadow-inner"
                        >
                            <option value="">Any</option>
                            {statusOptions.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Mobile Extra Options toggle button */}
                <div className="flex items-end justify-center lg:hidden lg:w-auto">
                    <button
                        onClick={onOpenMobileFilters}
                        className="h-[44px] w-full flex items-center justify-center gap-2 px-4 rounded-xl bg-dark-200 border border-gray-700/50 text-gray-300 hover:text-white hover:bg-white/5 hover:border-accent/40 transition-all font-bold text-sm"
                    >
                        <Filter className="w-4 h-4" />
                        <span>Advanced Filters</span>
                        {hasActiveFilters && (
                            <span className="w-2 h-2 bg-accent rounded-full mb-2 ml-1" />
                        )}
                    </button>
                </div>
            </div>
            
            {/* Desktop Action bar (sorting if needed, or advanced options) */}
            <div className="hidden lg:flex justify-end mt-4 pt-4 border-t border-gray-800/50">
                <button
                    onClick={onOpenMobileFilters}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white transition-colors border border-transparent hover:border-gray-700"
                >
                    <Filter className="w-3 h-3" />
                    Advanced Filters
                    {hasActiveFilters && (
                        <span className="w-1.5 h-1.5 bg-accent rounded-full ml-1" />
                    )}
                </button>
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
