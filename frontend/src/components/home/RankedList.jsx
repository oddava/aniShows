import { Link } from 'react-router-dom';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import StatusDot from '../ui/StatusDot';
import Skeleton from '../ui/Skeleton';
import useDelayedLoading from '../../hooks/useDelayedLoading';
import ErrorState from '../common/ErrorState';

function metaLine(anime) {
    const year = anime.release_date ? String(anime.release_date).slice(0, 4) : null;
    const genres = (anime.genres || []).slice(0, 2).map((genre) => genre.name).join(', ');
    return [anime.anime_type, year, genres].filter(Boolean).join(' · ');
}

/**
 * A short numbered chart ("Trending now", "Top rated"): rank, cover, title,
 * a line of facts and the site score. A denser read than a poster shelf, so
 * the page doesn't repeat one shape all the way down.
 */
export default function RankedList({ id, title, viewAllTo, items, isLoading, isError = false, onRetry, limit = 5 }) {
    const rows = (items || []).slice(0, limit);
    const showSkeleton = useDelayedLoading(isLoading, 1000);
    if (!isLoading && !isError && rows.length === 0) return null;

    return (
        <section aria-labelledby={id} className="panel min-w-0">
            <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
                <h2 id={id} className="section-title">{title}</h2>
                {viewAllTo && (
                    <Link to={viewAllTo} className="text-link shrink-0 text-[15px]" aria-label={`See all: ${title}`}>See all</Link>
                )}
            </div>
            {isError && !isLoading ? (
                <ErrorState
                    title={`Couldn’t load ${title.toLowerCase()}`}
                    message="This list didn’t load. The rest of the page is fine."
                    onRetry={onRetry}
                />
            ) : (
                <ol aria-busy={isLoading || undefined} className={isLoading && !showSkeleton ? 'invisible' : undefined}>
                    {isLoading
                        ? Array.from({ length: limit }, (_, i) => (
                            <li key={i} aria-hidden="true" className="flex items-center gap-4 py-2.5">
                                <Skeleton className="h-4 w-5" />
                                <Skeleton className="h-[62px] w-11 shrink-0" />
                                <div className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3.5 w-1/3" /></div>
                            </li>
                        ))
                        : rows.map((anime, index) => (
                            <li key={anime.id}>
                                <Link
                                    to={`/anime/${anime.slug}`}
                                    className="group -mx-3 flex items-center gap-4 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                                >
                                    <span className="w-5 shrink-0 text-right text-lg font-semibold text-[var(--text-3)] tabular">{index + 1}</span>
                                    <img
                                        src={getOptimizedImageUrl(anime, 'cover', 'small')}
                                        onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                                        alt=""
                                        loading="lazy"
                                        className="h-[62px] w-11 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                            <span className="line-clamp-1 font-semibold leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)]">{anime.title}</span>
                                            {anime.user_list_status?.status && <StatusDot status={anime.user_list_status.status} label className="shrink-0" />}
                                        </span>
                                        <span className="block truncate text-sm text-[var(--text-3)]">{metaLine(anime)}</span>
                                    </span>
                                    {Number(anime.rating) > 0 && (
                                        <span className="shrink-0 text-[15px] font-medium text-[var(--text-2)] tabular" aria-label={`Rated ${anime.rating}`}>
                                            {Number(anime.rating).toFixed(1)}
                                        </span>
                                    )}
                                </Link>
                            </li>
                        ))}
                </ol>
            )}
        </section>
    );
}
