import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { scheduleQueries } from '../../api/queries/anime';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import Skeleton from '../ui/Skeleton';
import useDelayedLoading from '../../hooks/useDelayedLoading';
import { clockTime, useMinuteClock, weekColumns } from './airingModel';

const PER_DAY = 4;

/**
 * The week as a seven-day calendar, today first: each day a column with the
 * shows that air on it, cover, time and episode, in your time zone. Members
 * see the shows on their list ("Your week"); visitors (`everyone`) see all
 * of them ("Airing this week"). What already aired today stays, dimmed and
 * marked "out". Phones scroll the days sideways. Same request as the
 * Schedule page, so it costs nothing extra.
 */
export default function AiringRibbon({ everyone = false }) {
    const now = useMinuteClock();
    const { isAuthenticated, user } = useAuth();
    const timezone = user?.preferred_timezone;
    const { data: scheduleDays, isPending } = useQuery({
        ...(everyone
            ? scheduleQueries.week(false, false)
            : scheduleQueries.week(isAuthenticated, Boolean(user?.show_adult_content))),
        staleTime: 5 * 60 * 1000,
        enabled: everyone || isAuthenticated,
    });

    const days = useMemo(
        () => weekColumns(scheduleDays, timezone, now, { listedOnly: !everyone }),
        [scheduleDays, timezone, now, everyone],
    );
    const airingCount = days.reduce((sum, day) => sum + day.shows.length, 0);
    const title = everyone ? 'Airing this week' : 'Your week';
    const showSkeleton = useDelayedLoading(isPending && everyone, 1000);

    // Visitors see this first thing, so it holds its place while loading
    // (shown only past a second). Members get nothing until the week is
    // known: a placeholder that may vanish (no show of theirs airs this
    // week) would pull the page up.
    if (isPending && everyone) {
        return (
            <section aria-hidden="true" className={`page-container ${showSkeleton ? '' : 'invisible'}`}>
                <Skeleton className="mb-5 h-6 w-48" />
                <Skeleton rounded="rounded-[var(--radius-lg)]" className="h-72 w-full" />
            </section>
        );
    }
    if (isPending || airingCount === 0) return null;

    return (
        <section aria-labelledby="ribbon-heading" className="page-container">
            <div className="mb-5 flex min-h-11 items-center justify-between gap-4">
                <div className="flex items-baseline gap-3">
                    <h2 id="ribbon-heading" className="section-title">{title}</h2>
                    {/* Visitors haven't chosen a zone: say which one the times are in. */}
                    {everyone && <span className="text-sm text-[var(--text-3)] max-sm:hidden">In your time zone</span>}
                </div>
                <Link to={everyone ? '/schedule' : '/schedule?mine=1'} className="text-link shrink-0 text-[15px]">Full schedule</Link>
            </div>
            {/* One panel; today is the soft-filled column. Wide screens: one
                row of seven, a quiet day narrower than a busy one so titles
                keep their width. Phones scroll the days inside the panel. */}
            <div className="panel p-2 md:p-2">
            <ol
                className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain scrollbar-hide lg:grid lg:snap-none lg:grid-cols-[var(--week-cols)] lg:overflow-visible"
                style={{ '--week-cols': days.map((day) => (day.shows.length ? 'minmax(0,1fr)' : 'minmax(0,0.6fr)')).join(' ') }}
            >
                {days.map((day) => {
                    const today = day.offset === 0;
                    return (
                        <li
                            key={day.offset}
                            aria-labelledby={`week-day-${day.offset}`}
                            className={`flex shrink-0 snap-start flex-col ${day.shows.length ? 'w-[10.5rem]' : 'w-28'} rounded-[var(--radius-md)] p-2 lg:w-auto ${today ? 'bg-white/[0.05]' : ''}`}
                        >
                            <h3 id={`week-day-${day.offset}`} aria-label={`${day.label}, ${day.date}`} className="flex items-baseline gap-1.5 px-1 pt-1 text-sm">
                                <span className={`font-semibold ${today ? 'text-[var(--signature)]' : 'text-[var(--text-1)]'}`}>
                                    {today ? 'Today' : day.weekday}
                                </span>
                                <span className="text-[var(--text-3)] tabular">{day.date}</span>
                            </h3>
                            {day.shows.length === 0 ? (
                                <p className="mt-3 px-1 pb-1 text-sm text-[var(--text-3)]">Nothing airs</p>
                            ) : (
                                <ul className="mt-2 flex flex-col gap-1">
                                    {day.shows.slice(0, PER_DAY).map(({ anime, at, aired }) => (
                                        <li key={anime.id}>
                                            <Link
                                                to={`/anime/${anime.slug}`}
                                                className={`group flex gap-2.5 rounded-[var(--radius-md)] p-1 transition-opacity ${aired ? 'opacity-60 hover:opacity-100' : ''}`}
                                            >
                                                <img
                                                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                                                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                                                    alt=""
                                                    loading="lazy"
                                                    className="h-14 w-10 shrink-0 rounded-md bg-[var(--ink-3)] object-cover"
                                                />
                                                <span className="min-w-0 flex-1 py-0.5">
                                                    <span className="block text-[13px] font-medium text-[var(--text-2)] tabular">
                                                        {at ? clockTime(at, timezone) : 'TBA'}
                                                        {anime.next_airing_episode ? ` · Ep ${anime.next_airing_episode}` : ''}
                                                        {aired && ' · out'}
                                                    </span>
                                                    <span className="line-clamp-2 text-[13px] leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)]">{anime.title}</span>
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {day.shows.length > PER_DAY && (
                                <Link to={everyone ? '/schedule' : '/schedule?mine=1'} className="text-link mt-auto min-h-9 px-1 text-sm">
                                    {day.shows.length - PER_DAY} more
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ol>
            </div>
        </section>
    );
}
