import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import FilterMenu from './FilterMenu';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const SEARCH_DEBOUNCE_MS = 450;
const MIN_SEARCH_LENGTH = 2;

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
    trailing = null,
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

    const setSingle = (key, value) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        if (value) {
            newParams.set(key, value);
            if (key === 'season' && !newParams.get('year')) {
                newParams.set('year', new Date().getFullYear().toString());
            }
        } else {
            newParams.delete(key);
        }
        setSearchParams(newParams);
    };

    const setGenres = (slugs) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        if (slugs.length > 0) newParams.set('genre', slugs.join(','));
        else newParams.delete('genre');
        setSearchParams(newParams);
    };

    const clearSearch = () => {
        setSearchInput('');
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('exclude_ids');
        newParams.delete('q');
        setSearchParams(newParams);
    };

    // Every genre is one tap away; the 18+ ones only show with 18+ on (or
    // while one is selected), and then last.
    const ADULT_GENRES = new Set(['ecchi', 'hentai']);
    const isAdultGenre = (genre) => ADULT_GENRES.has(String(genre.slug).toLowerCase());
    const quickGenres = !isGenresError && genres
        ? [...genres]
            .filter((genre) => !isAdultGenre(genre) || adultContentEnabled || currentGenres.includes(genre.slug))
            .sort((a, b) => Number(isAdultGenre(a)) - Number(isAdultGenre(b)))
        : [];

    return (
        <div className="mb-6 w-full">
            {/* Search, and on phones the filters sheet next to it. */}
            <div className="flex items-center gap-2">
                <div className="group relative flex-1">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--text-3)] transition-colors group-focus-within:text-[var(--signature)]" />
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
                        placeholder="Search anime"
                        className="h-12 w-full rounded-xl bg-white/[0.06] pl-11 pr-11 text-base text-[var(--text-1)] transition-colors placeholder:text-[var(--text-3)] hover:bg-white/[0.08] [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {searchInput && (
                        <button
                            type="button"
                            onClick={clearSearch}
                            aria-label="Clear search"
                            className="absolute right-1.5 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-white/[0.08] hover:text-[var(--text-1)]"
                        >
                            <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onOpenMobileFilters}
                    className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[var(--text-2)] transition-colors hover:bg-white/[0.09] hover:text-[var(--text-1)] sm:hidden"
                    aria-label="Filters"
                >
                    <SlidersHorizontal aria-hidden="true" className="h-[18px] w-[18px]" />
                    {hasActiveFilters && <span aria-hidden="true" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[var(--signature)]" />}
                </button>
            </div>

            {/* One row: filters on the left (desktop), sort and view on the right. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="hidden flex-wrap items-center gap-2 sm:flex">
                    <FilterMenu
                        label="Format"
                        options={typeOptions}
                        value={currentType}
                        onChange={(value) => setSingle('type', value)}
                    />
                    <FilterMenu
                        label="Season"
                        options={seasonOptions}
                        value={currentSeason}
                        onChange={(value) => setSingle('season', value)}
                    />
                    <FilterMenu
                        label="Year"
                        options={yearOptions.map((year) => ({ value: String(year), label: String(year) }))}
                        value={currentYear}
                        onChange={(value) => setSingle('year', value)}
                    />
                    {quickGenres.length > 0 && (
                        <FilterMenu
                            label="Genres"
                            multiple
                            columns={2}
                            options={quickGenres.map((genre) => ({ value: genre.slug, label: genre.name }))}
                            value={currentGenres}
                            onChange={setGenres}
                        />
                    )}
                    <button
                        type="button"
                        onClick={onOpenMobileFilters}
                        className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-[var(--text-2)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text-1)]"
                    >
                        <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                        More filters
                        {hasActiveFilters && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--signature)]" />}
                    </button>
                </div>
                {trailing && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{trailing}</div>}
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
    hasActiveFilters: PropTypes.bool,
    adultContentEnabled: PropTypes.bool,
    trailing: PropTypes.node,
};
