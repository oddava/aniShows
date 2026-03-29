import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Search, X, Filter } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import FlatSelect from './FlatSelect';

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
    const genreOptions = [
        { value: '', label: 'Any' },
        ...(!isGenresError && genres ? genres.map((genre) => ({ value: genre.slug, label: genre.name })) : [])
    ];
    const yearSelectOptions = [
        { value: '', label: 'Any' },
        ...yearOptions.map((year) => ({ value: year, label: String(year) }))
    ];
    const seasonSelectOptions = [
        { value: '', label: 'Any' },
        ...seasonOptions.map((season) => ({ value: season.value, label: season.label }))
    ];
    const formatSelectOptions = [
        { value: '', label: 'Any' },
        ...typeOptions.map((type) => ({ value: type.value, label: type.label }))
    ];
    const statusSelectOptions = [
        { value: '', label: 'Any' },
        ...statusOptions.map((status) => ({ value: status.value, label: status.label }))
    ];

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
                            className="w-full rounded-xl bg-dark-200 pl-10 pr-10 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:outline-none focus-visible:outline-none"
                        />
                        {searchInput && (
                            <button
                                onClick={clearSearch}
                                className="flat-control absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-dark p-0.5 text-gray-400 hover:text-white"
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
                        <FlatSelect
                            value={searchParams.get('genre') || ''}
                            onChange={(value) => handleSelectChange('genre', value)}
                            options={genreOptions}
                            placeholder="Any"
                            triggerClassName="bg-dark-200 text-gray-300"
                            menuClassName="bg-dark-100"
                        />
                    </div>

                    {/* Year Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Year</label>
                        <FlatSelect
                            value={searchParams.get('year') || ''}
                            onChange={(value) => handleSelectChange('year', value)}
                            options={yearSelectOptions}
                            placeholder="Any"
                            triggerClassName="bg-dark-200 text-gray-300"
                            menuClassName="bg-dark-100"
                        />
                    </div>

                    {/* Season Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Season</label>
                        <FlatSelect
                            value={searchParams.get('season') || ''}
                            onChange={(value) => handleSelectChange('season', value)}
                            options={seasonSelectOptions}
                            placeholder="Any"
                            triggerClassName="bg-dark-200 text-gray-300"
                            menuClassName="bg-dark-100"
                        />
                    </div>

                    {/* Format Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Format</label>
                        <FlatSelect
                            value={searchParams.get('type') || ''}
                            onChange={(value) => handleSelectChange('type', value)}
                            options={formatSelectOptions}
                            placeholder="Any"
                            triggerClassName="bg-dark-200 text-gray-300"
                            menuClassName="bg-dark-100"
                        />
                    </div>

                    {/* Status Dropdown */}
                    <div className="w-full relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Airing Status</label>
                        <FlatSelect
                            value={searchParams.get('status') || ''}
                            onChange={(value) => handleSelectChange('status', value)}
                            options={statusSelectOptions}
                            placeholder="Any"
                            triggerClassName="bg-dark-200 text-gray-300"
                            menuClassName="bg-dark-100"
                        />
                    </div>
                </div>

                {/* Mobile Extra Options toggle button */}
                <div className="flex items-end justify-center lg:hidden lg:w-auto">
                    <button
                        onClick={onOpenMobileFilters}
                        className="flat-control h-[44px] w-full rounded-xl bg-dark-200 px-4 text-sm font-bold text-gray-300 transition-colors hover:text-white focus:outline-none focus-visible:outline-none flex items-center justify-center gap-2"
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
                    className="flat-control flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-white focus:outline-none focus-visible:outline-none"
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
