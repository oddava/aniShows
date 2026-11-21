import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { scheduleQueries } from '../../api/queries/anime';
import { bucketScheduleByDate, formatDateTime } from '../../utils/dateUtils';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import Skeleton from '../ui/Skeleton';

const PREVIEW_ROWS = 5;

/**
 * The signed-out front page (L1), laid out like oddava.me's: what AniShows is
 * for on the left, and the product itself on the right: what actually airs
 * today, in the visitor's own time. No mock-ups, no marketing card.
 */
export default function GuestLanding() {
    const { data: scheduleDays, isPending } = useQuery({
        ...scheduleQueries.week(false, false),
        staleTime: 5 * 60 * 1000,
    });

    const today = useMemo(() => {
        const { days } = bucketScheduleByDate(scheduleDays || {});
        return [...(days[0] || [])]
            .sort((a, b) => (Date.parse(a.next_airing_date) || Infinity) - (Date.parse(b.next_airing_date) || Infinity))
            .slice(0, PREVIEW_ROWS);
    }, [scheduleDays]);

    return (
        <section aria-labelledby="landing-heading" className="page-container pt-24 pb-4 md:pt-36">
            <div className="grid gap-12 md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] md:gap-16">
                <div>
                    <h1 id="landing-heading" className="page-title max-w-md">
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
                    <p className="mt-2 text-sm text-[var(--text-3)]">
                        Already have an account? <Link to="/login" className="text-link min-h-0">Sign in</Link>
                    </p>
                </div>

                <div>
                    <h2 className="section-title">Airing today</h2>
                    <p className="mt-1 text-[15px] text-[var(--text-2)]">In your time zone.</p>
                    <ul className="mt-3">
                        {isPending
                            ? Array.from({ length: 4 }, (_, i) => (
                                <li key={i} className="flex items-center gap-4 border-b border-white/[0.06] py-3" aria-hidden="true">
                                    <Skeleton className="h-16 w-11 shrink-0" />
                                    <Skeleton className="h-4 w-1/2" />
                                </li>
                            ))
                            : today.map((anime) => (
                                <li key={anime.id} className="border-b border-white/[0.06] last:border-b-0">
                                    <Link to={`/anime/${anime.slug}`} className="group flex items-center gap-4 py-3">
                                        <img
                                            src={getOptimizedImageUrl(anime, 'cover', 'small')}
                                            onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                                            alt=""
                                            loading="lazy"
                                            className="h-16 w-11 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="line-clamp-1 font-semibold text-[var(--text-1)] group-hover:text-[var(--signature)]">{anime.title}</span>
                                            {anime.next_airing_episode && (
                                                <span className="block text-sm text-[var(--text-2)]">Episode {anime.next_airing_episode}</span>
                                            )}
                                        </span>
                                        <span className="shrink-0 text-sm text-[var(--text-2)] tabular">
                                            {anime.next_airing_date
                                                ? formatDateTime(anime.next_airing_date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
                                                : 'Time TBA'}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                    </ul>
                    {!isPending && today.length === 0 && (
                        <p className="border-t border-white/[0.06] pt-4 text-[15px] text-[var(--text-2)]">Nothing airs today.</p>
                    )}
                    <Link to="/schedule" className="text-link mt-2">See the week</Link>
                </div>
            </div>
        </section>
    );
}
