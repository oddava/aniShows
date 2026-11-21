import { ChevronDown } from 'lucide-react';
import TrackingPanel from './TrackingPanel';
import { applyImageFallback } from '../../utils/imageUtils';

/**
 * The head of the main column: on small screens the poster and tracking
 * actions, then the title, the expandable synopsis and (small screens) the
 * information box.
 */
export default function TitleSection({
    anime,
    accentColor,
    isAuthenticated,
    coverUrl,
    coverSrcSet,
    coverFallbackUrl,
    isCoverLoaded,
    setIsCoverLoaded,
    isFavorite,
    isLargeViewport,
    handleListUpdate,
    handleFavorite,
    synopsisExpanded,
    setSynopsisExpanded,
}) {
    return (
        <div className="text-left mb-8">
            <div className="lg:hidden mb-8">
                <div className="flex max-w-[460px] items-end gap-4">
                    <div className="w-[118px] md:w-40 flex-shrink-0">
                        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-dark-200 shadow-xl shadow-black/40 ring-1 ring-white/10">
                            {!isCoverLoaded && (
                                <div
                                    aria-hidden="true"
                                    className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                                />
                            )}
                            <img
                                src={coverUrl}
                                srcSet={coverSrcSet}
                                sizes="(min-width: 768px) 160px, 118px"
                                alt={anime.title}
                                onLoad={() => setIsCoverLoaded(true)}
                                onError={(event) => {
                                    setIsCoverLoaded(false);
                                    applyImageFallback(event, coverFallbackUrl);
                                }}
                                className={`w-full h-full object-cover text-transparent transition-opacity duration-700 ease-out ${isCoverLoaded ? 'opacity-100' : 'opacity-0'}`}
                            />
                        </div>
                    </div>

                    <div className="min-w-0 flex-1">
                        {!isLargeViewport && (
                            <TrackingPanel
                                anime={anime}
                                isAuthenticated={isAuthenticated}
                                isFavorite={isFavorite}
                                onFavorite={handleFavorite}
                                onListUpdate={handleListUpdate}
                                compact
                            />
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 sm:gap-3 lg:items-end lg:gap-4 mb-3 lg:mb-4 min-w-0">
                <h1 className="font-display text-[2.25rem] sm:text-5xl lg:text-6xl font-extrabold text-white leading-[0.98] tracking-[0.005em] text-left w-full lg:w-auto break-words">
                    {anime.title}
                </h1>
            </div>
            {anime.synopsis && (
                <div className="text-left mb-8">
                    <div className={`relative transition-all duration-500 ease-in-out ${!synopsisExpanded ? 'max-h-[140px] overflow-hidden' : 'max-h-[none]'}`}>
                        {anime.synopsis.split('\n').filter(p => p.trim()).map((para, i) => (
                            <p key={i} className="text-gray-200 font-medium leading-7 lg:leading-8 text-sm lg:text-base max-w-4xl mb-4 last:mb-0">
                                {para}
                            </p>
                        ))}
                        {anime.synopsis.length > 300 && !synopsisExpanded && (
                            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-dark via-dark/60 to-transparent pointer-events-none" />
                        )}
                    </div>
                    {anime.synopsis.length > 300 && (
                        <button
                            type="button"
                            onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                            aria-expanded={synopsisExpanded}
                            className="mt-2 -ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs lg:text-sm font-semibold text-gray-300 hover:text-white transition-colors"
                        >
                            {synopsisExpanded ? 'Show Less' : 'Read More'}
                            <ChevronDown className={`w-3.5 h-3.5 lg:w-4 lg:h-4 transition-transform ${synopsisExpanded ? 'rotate-180' : ''}`} />
                        </button>
                    )}
                </div>
            )}

        </div>
    );
}
