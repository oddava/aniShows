import TrackingPanel from './TrackingPanel';
import { NextEpisodePanel } from '../InformationBox';
import { applyImageFallback } from '../../utils/imageUtils';
import { capsToSentence } from '../detailTabs/format';

/**
 * The facts people look for first, in one line under the title:
 * "8.7 / 10 · TV · Fall 1999 · Toei Animation · Airing".
 */
function TitleMeta({ anime }) {
    const hasScore = anime.rating != null && anime.rating !== '' && Number(anime.rating) > 0;
    const season = anime.season
        ? [capsToSentence(anime.season), anime.season_year].filter(Boolean).join(' ')
        : (anime.season_year || (anime.release_date ? String(anime.release_date).slice(0, 4) : ''));
    const facts = [
        anime.anime_type,
        season,
        anime.studio?.name,
        anime.status && anime.status !== 'Finished' ? capsToSentence(anime.status) : null,
    ].filter(Boolean);

    if (!hasScore && facts.length === 0) return null;

    return (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[15px] text-[var(--text-2)] lg:mt-3 lg:text-[17px]">
            {/* Each separator trails its item, so a wrapped line never starts with "·". */}
            {[
                hasScore ? (
                    <span key="score" className="tabular">
                        <span className="font-semibold text-[var(--text-1)]">{anime.rating}</span>
                        <span className="text-[var(--text-3)]"> / 10</span>
                    </span>
                ) : null,
                ...facts.map((fact) => <span key={fact}>{fact}</span>),
            ].filter(Boolean).map((item, i, all) => (
                <span key={item.key} className="whitespace-nowrap">
                    {item}
                    {i < all.length - 1 && <span aria-hidden="true" className="ml-2 text-[var(--text-3)]">·</span>}
                </span>
            ))}
        </p>
    );
}

/**
 * The head of the main column. Small screens: the poster beside the title,
 * then the tracking controls on their own opaque surface (off the banner
 * art), the next episode, then the synopsis. Large screens: the title and synopsis only; the
 * poster and tracking live in PosterColumn.
 */
export default function TitleSection({
    anime,
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
    const isLongSynopsis = (anime.synopsis?.length || 0) > 300;

    return (
        <div className="mb-8 text-left lg:mb-10">
            <div className="flex min-w-0 items-end gap-4 lg:block">
                <div className="w-[104px] flex-shrink-0 md:w-36 lg:hidden">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] bg-[var(--ink-2)] shadow-[var(--shadow-pop)]">
                        <img
                            src={coverUrl}
                            srcSet={coverSrcSet}
                            sizes="(min-width: 768px) 144px, 104px"
                            alt={anime.title}
                            onLoad={() => setIsCoverLoaded(true)}
                            onError={(event) => {
                                setIsCoverLoaded(false);
                                applyImageFallback(event, coverFallbackUrl);
                            }}
                            className={`h-full w-full object-cover text-transparent transition-opacity duration-500 ease-out ${isCoverLoaded ? 'opacity-100' : 'opacity-0'}`}
                        />
                    </div>
                </div>

                <div className="min-w-0 flex-1 pb-1 lg:pb-0">
                    <h1 className="page-title break-words text-[1.75rem] sm:text-[2.25rem] lg:text-[3.25rem]">
                        {anime.title}
                    </h1>
                    <TitleMeta anime={anime} />
                </div>
            </div>

            {/* Small screens: the controls sit below the banner on the plain page
                surface, so the art never sits behind them. */}
            {!isLargeViewport && (
                <div className="mt-6 lg:hidden">
                    <TrackingPanel
                        anime={anime}
                        isAuthenticated={isAuthenticated}
                        isFavorite={isFavorite}
                        onFavorite={handleFavorite}
                        onListUpdate={handleListUpdate}
                        compact
                    />
                    {/* "When's the next one?" is the question this page answers
                        first, so on phones it follows the controls instead of
                        waiting below the whole overview. */}
                    <NextEpisodePanel anime={anime} className="mt-4" />
                </div>
            )}

            {anime.synopsis && (
                <div className="mt-6 lg:mt-5">
                    <div className={`relative ${!synopsisExpanded && isLongSynopsis ? 'max-h-[7rem] overflow-hidden lg:max-h-[8rem]' : ''}`}>
                        {anime.synopsis.split('\n').filter((p) => p.trim()).map((para, i) => (
                            <p key={i} className="mb-4 max-w-3xl text-[15px] leading-7 text-[var(--text-2)] last:mb-0 lg:text-base">
                                {para}
                            </p>
                        ))}
                        {isLongSynopsis && !synopsisExpanded && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--ink-0)] to-transparent" />
                        )}
                    </div>
                    {isLongSynopsis && (
                        <button
                            type="button"
                            onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                            aria-expanded={synopsisExpanded}
                            className="text-link mt-2 inline-flex min-h-11 items-center text-[15px]"
                        >
                            {synopsisExpanded ? 'Show less' : 'Read more'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
