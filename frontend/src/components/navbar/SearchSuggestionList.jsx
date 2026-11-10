import {
    applyImageFallback,
    getImageFallbackUrl,
    getOptimizedImageUrl,
} from '../../utils/imageUtils';

// Highlight matching text
const highlightMatch = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
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
    setSelectedIndex,
    handleSuggestionClick,
    handleSearch,
}) {
    return (
        <>
            {searchSuggestions.map((anime, index) => {
                const imageUrl = getOptimizedImageUrl(anime, 'cover', 'small');
                const fallbackImageUrl = getImageFallbackUrl(anime, 'cover');

                return (
                    <button
                        key={anime.id}
                        onClick={() => handleSuggestionClick(anime.slug)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`w-full flex items-center gap-3 border-l-2 p-3 text-left transition-colors ${selectedIndex === index
                            ? 'bg-accent/10 border-accent'
                            : 'border-transparent hover:bg-dark-50'
                            }`}
                    >
                        <img
                            src={imageUrl}
                            alt={anime.title}
                            onError={(event) => applyImageFallback(event, fallbackImageUrl)}
                            className="w-10 h-14 object-cover rounded-md flex-shrink-0 shadow-sm"
                        />
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-white line-clamp-1">
                                {highlightMatch(anime.title, searchQuery)}
                            </h4>
                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                                <span className="text-gray-500">{anime.anime_type}</span>
                                {anime.episode_count && (
                                    <>
                                        <span className="text-gray-600">•</span>
                                        <span>{anime.episode_count} eps</span>
                                    </>
                                )}
                            </div>
                        </div>
                        {anime.rating && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/10 rounded-md flex-shrink-0">
                                <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-tighter">Rating</span>
                                <span className="text-xs font-semibold text-yellow-500">{anime.rating}</span>
                            </div>
                        )}
                        {anime.isExactMatch && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-accent/20 text-accent rounded-full flex-shrink-0">
                                Exact
                            </span>
                        )}
                    </button>
                );
            })}

            <button
                onClick={handleSearch}
                className="w-full py-3 px-4 text-center text-sm font-medium text-accent hover:bg-dark-50 transition-colors border-t border-gray-700/50 flex items-center justify-center gap-2"
            >
                View all results for "{searchQuery}"
            </button>
        </>
    );
}
