import TrackingPanel from './TrackingPanel';
import InformationBox from '../InformationBox';
import FriendsWatching from '../FriendsWatching';
import { applyImageFallback } from '../../utils/imageUtils';

/**
 * Column 1 on large screens: the poster, the tracking actions, the
 * information box and friends watching.
 */
export default function PosterColumn({
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
}) {
    return (
        <div className="hidden lg:flex lg:flex-col gap-5">
            <div className="flex-shrink-0">
                <div className="relative w-44 sm:w-48 lg:w-full aspect-[2/3] overflow-hidden rounded-[var(--radius-lg)] bg-dark-200 shadow-[var(--shadow-pop)]">
                    {!isCoverLoaded && (
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                        />
                    )}
                    <img
                        src={coverUrl}
                        srcSet={coverSrcSet}
                        sizes="(max-width: 768px) 192px, (max-width: 1024px) 256px, 280px"
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

            {isLargeViewport && (
                <TrackingPanel
                    anime={anime}
                    isAuthenticated={isAuthenticated}
                    isFavorite={isFavorite}
                    onFavorite={handleFavorite}
                    onListUpdate={handleListUpdate}
                    compact
                />
            )}

            <InformationBox anime={anime} accentColor={accentColor} className="hidden lg:flex" />
            <div className="hidden lg:block">
                <FriendsWatching animeId={anime.id} accentColor={accentColor} />
            </div>
        </div>
    );
}
