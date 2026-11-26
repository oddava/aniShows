import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { scheduleQueries } from '../../api/queries/anime';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import Skeleton from '../ui/Skeleton';
import { airingPreview, previewWhen, useMinuteClock } from './airingModel';

const PREVIEW_ROWS = 5;

/**
 * The signed-out front page (L1), laid out like oddava.me's: what AniShows is
 * for on the left, and the product itself on the right: what actually airs
 * today, in the visitor's own time. No mock-ups, no marketing card.
 */
export default function GuestLanding() {
    const now = useMinuteClock();
    const { data: scheduleDays, isPending } = useQuery({
        ...scheduleQueries.week(false, false),
        staleTime: 5 * 60 * 1000,
    });

    // Today's episodes by time (aired ones say so), topped up with the next
    // ones tomorrow and after rather than "Time TBA" rows.
    const rows = useMemo(
        () => airingPreview(scheduleDays, undefined, now, PREVIEW_ROWS + 3).filter((row) => !row.aired).slice(0, PREVIEW_ROWS),
        [scheduleDays, now],
    );
    const allToday = rows.length > 0 && rows.every((row) => row.offset === 0);

    return (
        <section aria-labelledby="landing-heading" className="page-container pt-24 pb-4 md:pt-36">
            <div className="grid gap-12 md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] md:gap-16">
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

                <div className="panel">
                    <h2 className="section-title">{isPending || allToday || rows.length === 0 ? 'Airing today' : 'Airing soon'}</h2>
                    <p className="mt-1 text-[15px] text-[var(--text-2)]">In your time zone.</p>
                    <ul className="mt-3">
                        {isPending
                            ? Array.from({ length: 4 }, (_, i) => (
                                <li key={i} className="flex items-center gap-4 py-3" aria-hidden="true">
                                    <Skeleton className="h-16 w-11 shrink-0" />
                                    <Skeleton className="h-4 w-1/2" />
                                </li>
                            ))
                            : rows.map(({ anime, ...row }) => (
                                <li key={anime.id}>
                                    <Link to={`/anime/${anime.slug}`} className="group -mx-3 flex items-center gap-4 rounded-[var(--radius-md)] px-3 py-3">
                                        <img
                                            src={getOptimizedImageUrl(anime, 'cover', 'small')}
                                            onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                                            alt=""
                                            loading="lazy"
                                            className="h-16 w-11 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="line-clamp-2 font-semibold leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)] sm:line-clamp-1">{anime.title}</span>
                                            {/* Phones: when it airs sits under the title, so the title keeps the width. */}
                                            <span className="block text-sm text-[var(--text-2)] tabular">
                                                {anime.next_airing_episode ? `Episode ${anime.next_airing_episode}` : 'New episode'}
                                                <span className="sm:hidden"> · {previewWhen({ anime, ...row })}</span>
                                            </span>
                                        </span>
                                        <span className={`hidden shrink-0 text-right text-sm tabular sm:block ${row.aired ? 'text-[var(--text-3)]' : 'text-[var(--text-2)]'}`}>
                                            {previewWhen({ anime, ...row })}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                    </ul>
                    {!isPending && rows.length === 0 && (
                        <p className="pt-2 text-[15px] text-[var(--text-2)]">Nothing scheduled this week.</p>
                    )}
                    <Link to="/schedule" className="text-link mt-2">See the week</Link>
                </div>
            </div>
        </section>
    );
}
