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
        <div className="hidden lg:flex lg:flex-col gap-6">
            <div className="flex-shrink-0">
                <div className="relative w-full aspect-[2/3] overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-2)] shadow-[var(--shadow-pop)]">
                    <img
                        src={coverUrl}
                        srcSet={coverSrcSet}
                        sizes="(max-width: 768px) 192px, (max-width: 1024px) 256px, 280px"
                        alt={anime.title}
                        fetchPriority="high"
                        onLoad={() => setIsCoverLoaded(true)}
                        onError={(event) => {
                            setIsCoverLoaded(false);
                            applyImageFallback(event, coverFallbackUrl);
                        }}
                        className={`w-full h-full object-cover text-transparent transition-opacity duration-500 ease-out ${isCoverLoaded ? 'opacity-100' : 'opacity-0'}`}
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

            <InformationBox anime={anime} accentColor={accentColor} />
            <div className="hidden lg:block">
                <FriendsWatching animeId={anime.id} accentColor={accentColor} />
            </div>
        </div>
    );
}
