import { Link } from 'react-router-dom';
import { ChevronDown, Heart, Pencil, Plus } from 'lucide-react';
import StatusSelector from '../StatusSelector';
import InformationBox from '../InformationBox';
import { applyImageFallback } from '../../utils/imageUtils';

/**
 * The head of the main column: on small screens the poster and tracking
 * actions, then the title, the expandable synopsis and (small screens) the
 * information box.
 */
export default function TitleSection({
    anime,
    accentColor,
    mappedAccent,
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
    synopsisExpanded,
    setSynopsisExpanded,
}) {
    return (
        <div className="text-center lg:text-left mb-8">
            <div className="lg:hidden mb-8">
                <div className="mx-auto flex max-w-[330px] items-end gap-4">
                    <div className="w-[118px] flex-shrink-0">
                        <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-gray-800 bg-dark-200 shadow-xl">
                            {!isCoverLoaded && (
                                <div
                                    aria-hidden="true"
                                    className="absolute inset-0 animate-pulse bg-gradient-to-br from-dark-100 via-dark-200 to-dark-50"
                                />
                            )}
                            <img
                                src={coverUrl}
                                srcSet={coverSrcSet}
                                sizes="118px"
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
                        <div className="space-y-3" data-title="Mobile Tracking Actions">
                            {isAuthenticated ? (
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <StatusSelector
                                            animeId={anime.id}
                                            initialStatus={anime.user_list_status}
                                            onUpdate={handleListUpdate}
                                            totalEpisodes={anime.episode_count}
                                            compactSidebar={true}
                                            showEditInDropdown={false}
                                            externalEditTrigger={isLargeViewport ? 0 : editTriggerKey}
                                        />
                                    </div>
                                    <button
                                        onClick={handleOpenListEdit}
                                        title="Edit List Entry"
                                        className="w-9 h-9 flex justify-center items-center rounded-lg transition-all duration-300 bg-dark-100 text-gray-400 hover:text-white"
                                    >
                                        <Pencil className="w-4.5 h-4.5" />
                                    </button>
                                    <button
                                        onClick={handleFavorite}
                                        title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                                        className={`w-9 h-9 flex justify-center items-center rounded-lg transition-all duration-300
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
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 sm:gap-3 lg:items-end lg:gap-4 mb-2 min-w-0">
                <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold text-[rgb(209,213,219)] tracking-tight leading-tight sm:leading-none text-center lg:text-left w-full lg:w-auto break-words">
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
                            onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                            className={`mt-2 flex items-center gap-1.5 text-xs lg:text-sm font-bold transition-all active:scale-95 ${synopsisExpanded ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
                            style={{ color: mappedAccent }}
                        >
                            {synopsisExpanded ? 'Show Less' : 'Read More'}
                            <ChevronDown className={`w-3.5 h-3.5 lg:w-4 lg:h-4 transition-transform ${synopsisExpanded ? 'rotate-180' : ''}`} />
                        </button>
                    )}
                </div>
            )}

            <div className="lg:hidden mt-6 sm:mt-8 mb-8 sm:mb-12 space-y-4 sm:space-y-6">
                <InformationBox
                    anime={anime}
                    accentColor={accentColor}
                    className="max-h-[22rem] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
                />
            </div>
        </div>
    );
}
