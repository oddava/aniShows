import { Suspense, lazy, useEffect } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import logger from '../../utils/logger';
import { MIN_SEARCH_LENGTH } from './useAnimeSearchSuggestions';

// The result rows (images, highlighting) load in their own chunk, kept out of
// the entry. They are fetched as soon as the search is opened or focused, and
// results only show after the 200 ms debounce plus the request, so the chunk
// is in by then; until it is, the spinner stays up.
const loadSearchSuggestionList = () => import('./SearchSuggestionList');
const SearchSuggestionList = lazy(() =>
    loadSearchSuggestionList().catch((error) => {
        logger.error('Failed to load search suggestions:', error);
        return { default: () => null };
    })
);
const preloadSearchSuggestionList = () => {
    loadSearchSuggestionList().catch(() => {});
};

const SearchingIndicator = () => (
    <div className="py-6 text-center text-gray-400">
        <Loader2 aria-hidden="true" className="mx-auto mb-2 h-5 w-5 animate-spin text-[var(--signature)]" />
        <p className="text-sm">Searching…</p>
    </div>
);

/**
 * The navbar and hero search's "nothing found" state (B23): a hint about which
 * titles match and the full Browse search for the same query.
 */
export function SearchNoMatches({ query, onSearchAll }) {
    return (
        <div className="py-6 px-4 text-center text-gray-400" role="status">
            <p className="text-sm font-medium text-gray-300">
                No matches for &ldquo;{query}&rdquo;. Try the English or Japanese title
            </p>
            <button
                type="button"
                onClick={onSearchAll}
                className="mt-3 text-link text-sm"
            >
                Search all anime
            </button>
        </div>
    );
}

/**
 * The desktop header search: one plain field (no collapse), "/" or Ctrl+K to
 * focus, suggestions below. `search` is the state from useNavbarSearch.
 */
export default function NavbarSearch({ search }) {
    const {
        searchRef,
        searchInputRef,
        isSearchExpanded, setIsSearchExpanded,
        searchQuery, setSearchQuery,
        searchSuggestions,
        isSearching,
        noMatches,
        showSuggestions, setShowSuggestions,
        selectedIndex, setSelectedIndex,
        handleSuggestionClick,
        handleSearch,
        handleSearchBlur,
    } = search;

    useEffect(() => {
        if (isSearchExpanded || showSuggestions) {
            preloadSearchSuggestionList();
        }
    }, [isSearchExpanded, showSuggestions]);

    return (
        <div className="nav-search-slot ml-auto mr-2 w-60 lg:w-72" ref={searchRef} onBlur={handleSearchBlur}>
            <div className="relative">
                <form onSubmit={handleSearch} role="search" className="group/search relative">
                    <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)] transition-colors duration-150 group-focus-within/search:text-[var(--signature)]"
                    />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setSelectedIndex(-1);
                        }}
                        onFocus={() => {
                            setIsSearchExpanded(true);
                            preloadSearchSuggestionList();
                            if (searchQuery.trim().length >= MIN_SEARCH_LENGTH) {
                                setShowSuggestions(true);
                            }
                        }}
                        placeholder="Search anime"
                        aria-label="Search anime"
                        aria-keyshortcuts="/ Control+K"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={showSuggestions}
                        aria-controls={searchSuggestions.length > 0 ? 'navbar-search-listbox' : undefined}
                        aria-activedescendant={showSuggestions && selectedIndex >= 0 ? `navbar-search-option-${selectedIndex}` : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-10 w-full rounded-lg bg-white/[0.05] pl-9 pr-10 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] transition-colors duration-150 hover:bg-white/[0.07]"
                    />
                    {searchQuery ? (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setShowSuggestions(false);
                                setSelectedIndex(-1);
                                searchInputRef.current?.focus();
                            }}
                            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-white/[0.08] hover:text-[var(--text-1)]"
                            aria-label="Clear search"
                        >
                            <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                    ) : (
                        <kbd
                            aria-hidden="true"
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded bg-white/[0.06] px-1.5 py-0.5 font-sans text-[11px] leading-none text-[var(--text-3)] transition-opacity group-focus-within/search:opacity-0"
                        >
                            /
                        </kbd>
                    )}
                </form>

                {/* Enhanced Search Suggestions Dropdown - Always visible when active */}
                <div
                    inert={!showSuggestions}
                    tabIndex={-1}
                    className={`absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-[22rem] overflow-y-auto overflow-hidden rounded-xl bg-[var(--ink-3)] shadow-[var(--shadow-pop)] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] origin-top ${showSuggestions ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-1'
                        }`}
                >
                    {isSearching && searchSuggestions.length === 0 ? (
                        // Loading state - show previous results or skeleton
                        <SearchingIndicator />
                    ) : searchSuggestions.length > 0 ? (
                        <Suspense fallback={<SearchingIndicator />}>
                            <SearchSuggestionList
                                searchSuggestions={searchSuggestions}
                                searchQuery={searchQuery}
                                selectedIndex={selectedIndex}
                                setSelectedIndex={setSelectedIndex}
                                handleSuggestionClick={handleSuggestionClick}
                                handleSearch={handleSearch}
                            />
                        </Suspense>
                    ) : noMatches ? (
                        <SearchNoMatches query={searchQuery.trim()} onSearchAll={handleSearch} />
                    ) : null}
                </div>
            </div>
        </div>
    );
}
