import { useEffect } from 'react';
import { Star } from 'lucide-react';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getOptimizedImageUrl,
} from '../../utils/imageUtils';

// Highlight matching text
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Highlight matching text (the query is escaped: "a(" must not throw)
const highlightMatch = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
    return parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
            <span key={i} className="text-accent font-semibold">{part}</span>
        ) : (
            part
        )
    );
};

/**
 * The result rows of the navbar search dropdown plus "View all results".
 * Loaded lazily by NavbarSearch.
 */
export default function SearchSuggestionList({
    searchSuggestions,
    searchQuery,
    selectedIndex,
    handleSuggestionClick,
    handleSearch,
    idPrefix = 'navbar-search',
}) {
    // Keep the arrow-key selection visible inside the scrolling dropdown
    // (focus stays in the input; only the list scrolls).
    useEffect(() => {
        if (selectedIndex < 0) return;
        document.getElementById(`${idPrefix}-option-${selectedIndex}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [selectedIndex, idPrefix]);

    return (
        <>
            <div role="listbox" id={`${idPrefix}-listbox`} aria-label="Search suggestions">
            {searchSuggestions.map((anime, index) => {
                const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
                const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');

                return (
                    <div
                        key={anime.id}
                        id={`${idPrefix}-option-${index}`}
                        role="option"
                        aria-selected={selectedIndex === index}
                        onClick={() => handleSuggestionClick(anime.slug)}
                        className={`w-full cursor-pointer flex items-center gap-3 p-3 text-left transition-colors ${selectedIndex === index
 ? 'bg-accent/10 border-accent'
                            : 'border-transparent hover:bg-dark-50'
                            }`}
                    >
                        <img
                            src={imageUrl}
                            alt=""
                            loading="lazy"
                            onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                            className="w-10 h-14 object-cover rounded-md flex-shrink-0 shadow-sm"
                        />
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-white line-clamp-1">
                                {highlightMatch(anime.title, searchQuery)}
                            </h4>
                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                                <span className="text-gray-500">{anime.anime_type}</span>
                                {anime.episode_count > 0 && (
                                    <>
                                        <span className="text-gray-600">•</span>
                                        <span>{anime.episode_count} {anime.episode_count === 1 ? 'ep' : 'eps'}</span>
                                    </>
                                )}
                            </div>
                        </div>
                        {Number(anime.rating) > 0 && (
                            <span className="flex items-center gap-1 flex-shrink-0 text-xs font-semibold text-yellow-400 tabular">
                                <Star aria-hidden="true" className="w-3 h-3 fill-current" />
                                <span className="sr-only">Rating </span>{anime.rating}
                            </span>
                        )}
                    </div>
                );
            })}
            </div>

            <button
                type="button"
                tabIndex={-1}
                onClick={handleSearch}
                className="w-full py-3 px-4 text-center text-sm font-medium text-accent hover:bg-dark-50 transition-colors flex items-center justify-center gap-2"
            >
                View all results for "{searchQuery}"
            </button>
        </>
    );
}
