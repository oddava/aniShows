import { Suspense, lazy, useEffect } from 'react';
import { Search } from 'lucide-react';
import logger from '../../utils/logger';

// The result rows (images, highlighting) load in their own chunk, kept out of
// the entry. They are fetched as soon as the search is opened or focused, and
// results only show after the 200 ms debounce plus the 300 ms minimum spinner,
// so the chunk is in by then; until it is, the spinner stays up.
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
        <div className="w-6 h-6 mx-auto mb-2 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Searching...</p>
    </div>
);

/**
 * The collapsible desktop search box and its suggestions dropdown. `search` is
 * the state from useNavbarSearch.
 */
export default function NavbarSearch({ search }) {
    const {
        searchRef,
        searchInputRef,
        isSearchExpanded, setIsSearchExpanded,
        searchQuery, setSearchQuery,
        searchSuggestions,
        isSearching,
        showSuggestions, setShowSuggestions,
        selectedIndex, setSelectedIndex,
        handleSuggestionClick,
        handleSearch,
    } = search;

    useEffect(() => {
        if (isSearchExpanded || showSuggestions) {
            preloadSearchSuggestionList();
        }
    }, [isSearchExpanded, showSuggestions]);

    return (
        <div className="flex-1 flex justify-end mx-2 lg:mx-4" ref={searchRef}>
            <div className={`relative transition-[width,max-width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${isSearchExpanded ? 'w-full max-w-[16rem] lg:max-w-[22rem]' : 'w-10 lg:w-52'}`}>
                <form onSubmit={handleSearch} className="relative group/search flex items-center justify-end w-full h-full">
                    {/* Search Icon / Toggle Button */}
                    <button
                        type="button"
                        onClick={() => {
                            if (!isSearchExpanded) {
                                setIsSearchExpanded(true);
                                setTimeout(() => searchInputRef.current?.focus(), 50);
                            }
                        }}
                        className={`absolute left-0 z-10 flex items-center transition-colors duration-200 ${isSearchExpanded ? 'h-[36px] w-[36px] justify-center pointer-events-none' : 'w-10 h-10 lg:w-full lg:h-9 justify-center lg:justify-start lg:gap-2.5 lg:pl-3 lg:pr-2 rounded-full lg:bg-dark-100 lg:border lg:border-white/5 text-gray-300 hover:text-white hover:bg-white/10 lg:hover:bg-dark-100 lg:hover:border-white/10 cursor-pointer pointer-events-auto'}`}
                        aria-label="Toggle Search"
                        aria-keyshortcuts="/ Control+K"
                        tabIndex={isSearchExpanded ? -1 : 0}
                    >
                        <Search aria-hidden="true" className={`w-4 h-4 shrink-0 transition-colors duration-200 ${isSearchExpanded ? 'text-gray-500 group-focus-within/search:text-accent' : ''}`} />
                        {!isSearchExpanded && (
                            <>
                                <span className="hidden lg:inline text-sm text-gray-500">Search anime…</span>
                                <kbd className="hidden lg:inline ml-auto px-1.5 py-0.5 rounded font-mono text-[10px] leading-none text-gray-500 border border-white/10">/</kbd>
                            </>
                        )}
                    </button>

                    {/* Input */}
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setSelectedIndex(-1);
                        }}
                        onFocus={() => {
                            preloadSearchSuggestionList();
                            if (searchQuery.trim().length >= 1) {
                                setShowSuggestions(true);
                            }
                        }}
                        placeholder="Search anime..."
                        aria-label="Search anime"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={showSuggestions}
                        aria-controls="navbar-search-suggestions"
                        tabIndex={isSearchExpanded ? 0 : -1}
                        className={`w-full rounded-full border border-white/5 bg-dark-100 py-2 pl-10 pr-8 text-sm text-white placeholder:text-gray-500 transition-all duration-[400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] focus:border-accent/40 focus:bg-dark-100 focus:outline-none focus:ring-4 focus:ring-accent/20 ${isSearchExpanded ? 'opacity-100 scale-x-100 pointer-events-auto origin-right' : 'opacity-0 scale-x-75 pointer-events-none border-transparent bg-transparent origin-right'}`}
                    />

                    {/* Clear button */}
                    {searchQuery && isSearchExpanded && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setShowSuggestions(false);
                                setSelectedIndex(-1);
                                searchInputRef.current?.focus();
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                            aria-label="CLEAR"
                        >
                            <span className="text-[10px] font-bold">CLEAR</span>
                        </button>
                    )}

                    {/* Keyboard shortcut hint */}
                    {!searchQuery && isSearchExpanded && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 pointer-events-none">
                            <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono text-[10px] text-gray-400 border border-white/10">/</kbd>
                        </div>
                    )}
                </form>

                {/* Enhanced Search Suggestions Dropdown - Always visible when active */}
                <div
                    id="navbar-search-suggestions"
                    aria-hidden={!showSuggestions}
                    className={`absolute left-0 right-0 top-full z-50 mt-3 max-h-[70vh] overflow-y-auto overflow-hidden rounded-2xl border border-white/10 bg-dark-100 shadow-2xl shadow-black/50 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] origin-top ${showSuggestions ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-1'
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
                    ) : searchQuery.trim().length >= 2 ? (
                        <div className="py-8 text-center text-gray-400">
                            <p className="text-sm font-medium text-gray-300">No results found</p>
                            <p className="text-xs mt-1 text-gray-500">Try different keywords</p>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
