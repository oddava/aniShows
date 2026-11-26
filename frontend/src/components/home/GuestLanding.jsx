import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { animeQueries } from '../../api/queries/anime';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import Skeleton from '../ui/Skeleton';
import useDelayedLoading from '../../hooks/useDelayedLoading';
import { countdown } from './continueModel';
import { clockTime, dayOffset, useMinuteClock } from './airingModel';
import { formatDate } from '../../utils/dateUtils';

/**
 * "Episode 9 · Sun 19:16 · in 3d 2h" for the featured show's next episode;
 * past a week (a show on break) just the date: "Episode 1181 · 3 Jan".
 */
function nextEpisodeLine(anime, now) {
    const at = Date.parse(anime.next_airing_date);
    if (!Number.isFinite(at) || at <= now) return null;
    const episode = anime.next_airing_episode ? `Episode ${anime.next_airing_episode} · ` : '';
    const offset = dayOffset(at, undefined, now);
    if (offset > 6) return `${episode}${formatDate(at, { day: 'numeric', month: 'short' })}`;
    const day = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatDate(at, { weekday: 'short' });
    return `${episode}${day} ${clockTime(at)} · in ${countdown(at, now)}`;
}

/**
 * The signed-out front page (L1): what AniShows is for on the left, and the
 * show everyone is watching this week on the right, its banner and when the
 * next episode airs in the visitor's own time. The week's calendar follows
 * (Home). Real data only: no mock-ups, no marketing card.
 */
export default function GuestLanding() {
    const now = useMinuteClock();
    // The same request as the Trending shelf below (shared cache).
    const { data: trending, isPending } = useQuery({
        ...animeQueries.trending('guest-home'),
        staleTime: 1000 * 60 * 15,
        gcTime: 1000 * 60 * 30,
    });
    const showSkeleton = useDelayedLoading(isPending, 1000);
    const featured = (trending || []).find((anime) => anime.banner_image || anime.banner_image_external_url) || trending?.[0];
    const genres = (featured?.genres || []).slice(0, 3).map((genre) => genre.name).join(', ');
    const next = featured ? nextEpisodeLine(featured, now) : null;

    return (
        <section aria-labelledby="landing-heading" className="page-container pb-14 pt-[5.5rem] md:pb-20 md:pt-24">
            <div className="grid items-center gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-14">
                <div>
                    <h1 id="landing-heading" className="page-title max-w-[22ch] text-balance">
                        Never lose your place. Know what’s on tonight.
                    </h1>
                    <p className="mt-4 max-w-md text-[17px] leading-relaxed text-[var(--text-2)]">
                        AniShows keeps your anime list, shows which episode is next, and tells you when it airs
                        in your time zone. One tap to mark an episode watched.
                    </p>
                    <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <Link to="/register" className="btn-primary">Create an account</Link>
                        <Link to="/import" className="text-link">Import from MAL or AniList</Link>
                    </div>
                </div>

                {isPending ? (
                    <div aria-hidden="true" className={`overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-1)] ${showSkeleton ? '' : 'invisible'}`}>
                        <Skeleton rounded="rounded-none" className="aspect-[2/1]" />
                        <div className="p-5 md:px-6"><Skeleton className="h-3.5 w-24" /><Skeleton className="mt-3 h-6 w-1/2" /><Skeleton className="mt-3 h-4 w-2/3" /></div>
                    </div>
                ) : featured ? (
                    <article aria-labelledby="featured-title" className="panel overflow-hidden p-0 md:p-0">
                        <Link to={`/anime/${featured.slug}`} tabIndex={-1} aria-hidden="true" className="block aspect-[2/1] overflow-hidden">
                            <img
                                src={getOptimizedImageUrl(featured, 'banner', 'large')}
                                onError={(event) => applyImageFallback(event, getImageFallbackUrl(featured, 'banner'))}
                                alt=""
                                fetchPriority="high"
                                className="h-full w-full bg-[var(--ink-2)] object-cover transition-[filter] duration-200 hover:brightness-110"
                            />
                        </Link>
                        <div className="flex flex-col gap-1 p-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6 md:px-6">
                            <div className="min-w-0">
                                <p className="text-sm text-[var(--text-3)]">Trending this week</p>
                                <h2 id="featured-title" className="mt-1 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-[var(--text-1)]">
                                    <Link to={`/anime/${featured.slug}`} className="line-clamp-1 transition-colors hover:text-[var(--signature)]">{featured.title}</Link>
                                </h2>
                                <p className="mt-1 truncate text-sm text-[var(--text-2)] tabular">{next || genres}</p>
                            </div>
                            {Number(featured.rating) > 0 && (
                                <p className="shrink-0 text-sm text-[var(--text-2)] tabular">Rated {Number(featured.rating).toFixed(1)}</p>
                            )}
                        </div>
                    </article>
                ) : null}
            </div>
        </section>
    );
}
