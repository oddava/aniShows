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
            <div className={`relative transition-all duration-[400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${isSearchExpanded ? 'w-full max-w-[16rem] lg:max-w-[22rem]' : 'w-10'}`}>
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
                        className={`absolute left-0 z-10 flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-0 outline-none ${isSearchExpanded ? 'h-[36px] w-[36px] pointer-events-none' : 'w-10 h-10 rounded-full hover:bg-white/10 cursor-pointer pointer-events-auto'}`}
                        aria-label="Toggle Search"
                    >
                        <Search className={`w-4 h-4 transition-colors duration-300 ${isSearchExpanded ? 'text-gray-500 group-focus-within/search:text-accent' : 'text-gray-300 hover:text-white'}`} />
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
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none"
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
                    className={`absolute left-0 right-0 top-full z-50 mt-3 max-h-[70vh] overflow-y-auto overflow-hidden rounded-2xl border border-white/10 bg-dark-100 shadow-2xl transition-all duration-300 origin-top ${showSuggestions ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95'
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
