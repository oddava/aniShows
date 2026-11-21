import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { scheduleQueries } from '../../api/queries/anime';
import Skeleton from '../ui/Skeleton';
import { clockTime, useMinuteClock, weekAgenda } from './airingModel';

const PER_DAY = 5;

/**
 * Your week: the shows on your list airing in the next seven days, as a
 * short agenda of only the days that have one, in your time zone. What
 * already aired today stays, dimmed and marked "out". Same request as the
 * Schedule page, so it costs nothing extra.
 */
export default function AiringRibbon() {
    const now = useMinuteClock();
    const { isAuthenticated, user } = useAuth();
    const timezone = user?.preferred_timezone;
    const { data: scheduleDays, isPending } = useQuery({
        ...scheduleQueries.week(isAuthenticated, Boolean(user?.show_adult_content)),
        staleTime: 5 * 60 * 1000,
        enabled: isAuthenticated,
    });

    const days = useMemo(() => weekAgenda(scheduleDays, timezone, now), [scheduleDays, timezone, now]);

    if (!isPending && days.length === 0) return null;

    return (
        <section aria-labelledby="ribbon-heading" className="page-container">
            <div className="panel">
                <div className="mb-4 flex items-baseline justify-between gap-4">
                    <h2 id="ribbon-heading" className="section-title">Your week</h2>
                    <Link to="/schedule?mine=1" className="text-link shrink-0 text-[15px]">Full schedule</Link>
                </div>
                {isPending ? (
                    <div aria-hidden="true" className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
                        {Array.from({ length: 2 }, (_, i) => (
                            <div key={i}>
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="mt-3 h-10 w-full" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
                        {days.map((day) => (
                            <section key={day.offset} aria-labelledby={`week-day-${day.offset}`} className="min-w-0">
                                <h3 id={`week-day-${day.offset}`} className="flex items-baseline gap-2 text-[15px]">
                                    <span className={`font-semibold ${day.offset === 0 ? 'text-[var(--signature)]' : 'text-[var(--text-1)]'}`}>{day.label}</span>
                                    <span className="text-sm text-[var(--text-3)] tabular">{day.date}</span>
                                </h3>
                                <ul className="-mx-2 mt-1">
                                    {day.shows.slice(0, PER_DAY).map(({ anime, at, aired }) => (
                                        <li key={anime.id}>
                                            <Link
                                                to={`/anime/${anime.slug}`}
                                                className={`group flex min-h-11 items-baseline gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04] ${aired ? 'opacity-60 hover:opacity-100' : ''}`}
                                            >
                                                <span className="w-11 shrink-0 text-sm text-[var(--text-2)] tabular">
                                                    {at ? clockTime(at, timezone) : 'TBA'}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="line-clamp-2 text-[15px] leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)]">{anime.title}</span>
                                                    <span className="block text-[13px] text-[var(--text-3)] tabular">
                                                        {anime.next_airing_episode ? `Episode ${anime.next_airing_episode}` : 'New episode'}
                                                        {aired && ' · out'}
                                                    </span>
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                                {day.shows.length > PER_DAY && (
                                    <Link to="/schedule?mine=1" className="text-link min-h-9 text-sm">
                                        {day.shows.length - PER_DAY} more
                                    </Link>
                                )}
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
