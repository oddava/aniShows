import { useState } from 'react';
import PropTypes from 'prop-types';

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

const SectionHeader = ({ children }) => (
    <h3 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-3">{children}</h3>
);

SectionHeader.propTypes = {
    children: PropTypes.node.isRequired
};

export default function AdvancedFiltersPanel({
    isOpen,
    genres = [],
    studios = [],
    isGenresError = false,
    isStudiosError = false,
    localFilters,
    onUpdateFilter,
    onToggleGenre,
    typeOptions,
    statusOptions,
    seasonOptions
}) {
    const [genreSearch, setGenreSearch] = useState('');
    const [showAllGenres, setShowAllGenres] = useState(false);

    const filteredGenres = genres.filter(g =>
        g.name.toLowerCase().includes(genreSearch.toLowerCase())
    );
    const displayedGenres = showAllGenres ? filteredGenres : filteredGenres.slice(0, 24);

    if (!isOpen) return null;

    return (
        <div className="w-full bg-dark-100 rounded-2xl border border-gray-800/50 mb-8 overflow-hidden animate-fade-in">
            <div className="p-6 sm:p-8 space-y-8">
                
                {/* Top Row: Year, Season, Format, Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
                    {/* Status */}
                    <div>
                        <SectionHeader>Airing Status</SectionHeader>
                        <div className="flex flex-wrap gap-2">
                            {statusOptions.map(status => (
                                <Pill
                                    key={status.value}
                                    active={localFilters.status === status.value}
                                    label={status.label}
                                    onClick={() => onUpdateFilter('status', localFilters.status === status.value ? '' : status.value)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Format */}
                    <div>
                        <SectionHeader>Format</SectionHeader>
                        <div className="flex flex-wrap gap-2">
                            {typeOptions.map(type => (
                                <Pill
                                    key={type.value}
                                    active={localFilters.type === type.value}
                                    label={type.label}
                                    onClick={() => onUpdateFilter('type', localFilters.type === type.value ? '' : type.value)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Season */}
                    <div>
                        <SectionHeader>Season</SectionHeader>
                        <div className="flex flex-wrap gap-2">
                            {seasonOptions.map(season => (
                                <Pill
                                    key={season.value}
                                    active={localFilters.season === season.value}
                                    label={season.label}
                                    onClick={() => onUpdateFilter('season', localFilters.season === season.value ? '' : season.value)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Studios (Select or long list of pills?) */}
                    {/* The prompt says "same pill/toggle style for options like Status, Format, Season". Studios has many options. */}
                    <div>
                        <SectionHeader>Studio</SectionHeader>
                        {isStudiosError ? (
                            <p className="text-xs text-red-400">Failed to load studios</p>
                        ) : (
                            <div className="relative">
                                <select
                                    value={localFilters.studio || ''}
                                    onChange={(e) => onUpdateFilter('studio', e.target.value)}
                                    className="w-full rounded-xl bg-dark-200 px-4 py-2.5 text-sm text-gray-300 outline-none transition-colors border-none focus:ring-1 focus:ring-accent appearance-none"
                                >
                                    <option value="">All Studios</option>
                                    {studios?.map((studio) => (
                                        <option key={studio.id} value={studio.id}>{studio.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Rating & Full Genres */}
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                    
                    {/* Rating Slider */}
                    <div className="xl:col-span-1">
                        <SectionHeader>Rating</SectionHeader>
                        <div className="px-2 pt-4">
                            {/* NATIVE DUAL RANGE SLIDER IMPLEMENTATION */}
                            <div className="relative h-2 rounded-full bg-dark-200">
                                <div 
                                    className="absolute h-full bg-accent rounded-full"
                                    style={{ 
                                        left: `${((localFilters.minRating || 0) / 10) * 100}%`, 
                                        right: `${100 - ((localFilters.maxRating || 10) / 10) * 100}%` 
                                    }}
                                />
                                <input
                                    type="range"
                                    min="0"
                                    max="10"
                                    step="0.5"
                                    value={localFilters.minRating || 0}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        const max = parseFloat(localFilters.maxRating || 10);
                                        if (val <= max) onUpdateFilter('minRating', val.toString());
                                    }}
                                    className="absolute w-full -top-1.5 h-5 appearance-none bg-transparent pointer-events-auto cursor-pointer"
                                    style={{ zIndex: 3 }}
                                />
                                <input
                                    type="range"
                                    min="0"
                                    max="10"
                                    step="0.5"
                                    value={localFilters.maxRating || 10}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        const min = parseFloat(localFilters.minRating || 0);
                                        if (val >= min) onUpdateFilter('maxRating', val.toString());
                                    }}
                                    className="absolute w-full -top-1.5 h-5 appearance-none bg-transparent pointer-events-auto cursor-pointer"
                                    style={{ zIndex: 4 }}
                                />
                            </div>
                            <div className="flex justify-between items-center mt-4 text-sm font-bold text-gray-400">
                                <span>{localFilters.minRating || 0}</span>
                                <span>{localFilters.maxRating || 10}</span>
                            </div>
                        </div>
                    </div>

                    {/* Genres */}
                    <div className="xl:col-span-3">
                        <div className="flex items-center justify-between mb-3">
                            <SectionHeader>All Genres</SectionHeader>
                            <input
                                type="text"
                                placeholder="Filter genres..."
                                value={genreSearch}
                                onChange={(e) => setGenreSearch(e.target.value)}
                                className="w-[150px] sm:w-[200px] -mt-2 bg-transparent border-b border-gray-700 pb-1 text-sm text-white focus:outline-none focus:border-accent"
                            />
                        </div>
                        {isGenresError ? (
                            <p className="text-xs text-red-400">Failed to load genres</p>
                        ) : (
                            <div>
                                <div className="flex flex-wrap gap-2">
                                    {displayedGenres.map(genre => (
                                        <Pill
                                            key={genre.slug}
                                            active={localFilters.genres.includes(genre.slug)}
                                            label={genre.name}
                                            onClick={() => onToggleGenre(genre.slug)}
                                        />
                                    ))}
                                </div>
                                {!genreSearch && genres.length > 24 && (
                                    <button
                                        onClick={() => setShowAllGenres(!showAllGenres)}
                                        className="mt-4 text-xs font-bold text-gray-500 hover:text-white uppercase tracking-wider"
                                    >
                                        {showAllGenres ? 'Show Less' : `Show All (${genres.length})`}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Custom CSS for hiding the default thumb of the range input to make dual slider work visually */}
            <style>{`
                input[type=range]::-webkit-slider-thumb {
                    pointer-events: all;
                    width: 16px;
                    height: 16px;
                    -webkit-appearance: none;
                    border-radius: 50%;
                    background: white;
                    border: 2px solid #553C9A; /* Use the accent color roughly */
                    cursor: ew-resize;
                }
                input[type=range]::-moz-range-thumb {
                    pointer-events: all;
                    width: 16px;
                    height: 16px;
                    appearance: none;
                    border-radius: 50%;
                    background: white;
                    border: 2px solid #553C9A;
                    cursor: ew-resize;
                }
            `}</style>
        </div>
    );
}

AdvancedFiltersPanel.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    genres: PropTypes.array,
    studios: PropTypes.array,
    isGenresError: PropTypes.bool,
    isStudiosError: PropTypes.bool,
    localFilters: PropTypes.object.isRequired,
    onUpdateFilter: PropTypes.func.isRequired,
    onToggleGenre: PropTypes.func.isRequired,
    typeOptions: PropTypes.array.isRequired,
    statusOptions: PropTypes.array.isRequired,
    seasonOptions: PropTypes.array.isRequired
};
