import { Link } from 'react-router-dom';
import { Heart, Pencil, Plus } from 'lucide-react';
import StatusSelector from '../StatusSelector';
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
    editTriggerKey,
    handleListUpdate,
    handleOpenListEdit,
    handleFavorite,
}) {
    return (
        <div className="hidden lg:flex lg:flex-col gap-5">
            <div className="flex-shrink-0">
                <div className="relative w-44 sm:w-48 lg:w-full aspect-[2/3] overflow-hidden rounded-xl border border-gray-800 bg-dark-200 shadow-xl">
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

            {/* Main Actions - Unified Sidebar Grid */}
            <div className="space-y-2 w-full" data-title="Tracking Actions">
                {isAuthenticated ? (
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <StatusSelector
                                animeId={anime.id}
                                initialStatus={anime.user_list_status}
                                onUpdate={handleListUpdate}
                                totalEpisodes={anime.episode_count}
                                compactSidebar={true}
                                showEditInDropdown={false}
                                externalEditTrigger={isLargeViewport ? editTriggerKey : 0}
                            />
                        </div>
                        <button
                            onClick={handleOpenListEdit}
                            title="Edit List Entry"
                            className="w-9 h-9 self-start flex justify-center items-center rounded-lg transition-all duration-300 bg-dark-100 text-gray-400 hover:text-white"
                        >
                            <Pencil className="w-4.5 h-4.5" />
                        </button>
                        <button
                            onClick={handleFavorite}
                            title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                            className={`w-9 h-9 self-start flex justify-center items-center rounded-lg transition-all duration-300
                                ${isFavorite 
                                    ? 'bg-red-500/10 text-red-500' 
                                    : 'bg-dark-100 text-gray-400 hover:text-white'}`}
                        >
                            <Heart className={`w-4.5 h-4.5 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                    </div>
                ) : (
                    <div className="w-full">
                        <Link to="/login" className="btn-primary py-2.5 px-6 rounded-lg flex items-center justify-center gap-2 text-sm font-bold w-full shadow-lg">
                            <Plus className="w-4 h-4" /> Sign In to Track
                        </Link>
                    </div>
                )}
            </div>

            <InformationBox anime={anime} accentColor={accentColor} className="hidden lg:flex" />
            <div className="hidden lg:block">
                <FriendsWatching animeId={anime.id} accentColor={accentColor} />
            </div>
        </div>
    );
}
