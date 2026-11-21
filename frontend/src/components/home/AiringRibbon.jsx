import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { scheduleQueries } from '../../api/queries/anime';
import { bucketScheduleByDate, formatDateTime, getZonedCalendarToday, SCHEDULE_DAYS } from '../../utils/dateUtils';
import { statusMeta } from '../../utils/listStatus';
import Skeleton from '../ui/Skeleton';

const LISTED = new Set(['Watching', 'Plan to Watch', 'On Hold']);

/**
 * The airing ribbon: your shows across the next seven days, in your time
 * zone, today first. AniShows' signature strip (schedule + your list), reused
 * from the Schedule page's data, so it costs no extra request.
 */
export default function AiringRibbon() {
    const { isAuthenticated, user } = useAuth();
    const timezone = user?.preferred_timezone;
    const { data: scheduleDays, isPending } = useQuery({
        ...scheduleQueries.week(isAuthenticated, Boolean(user?.show_adult_content)),
        staleTime: 5 * 60 * 1000,
        enabled: isAuthenticated,
    });

    const days = useMemo(() => {
        const { days: buckets } = bucketScheduleByDate(scheduleDays || {}, timezone);
        const today = getZonedCalendarToday(timezone);
        return Array.from({ length: SCHEDULE_DAYS }, (_, offset) => {
            const date = new Date(today.getTime() + offset * 86400000);
            const shows = (buckets[offset] || []).filter((anime) => LISTED.has(anime.user_list_status?.status));
            return {
                offset,
                weekday: offset === 0 ? 'Today' : date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
                day: date.getUTCDate(),
                shows,
            };
        });
    }, [scheduleDays, timezone]);

    const total = days.reduce((sum, day) => sum + day.shows.length, 0);
    if (!isPending && total === 0) return null;

    return (
        <section aria-labelledby="ribbon-heading" className="page-container">
            <div className="mb-5 flex items-end justify-between gap-4">
                <h2 id="ribbon-heading" className="section-title">Your week</h2>
                <Link to="/schedule?mine=1" className="text-link shrink-0 text-[15px]">full schedule</Link>
            </div>
            <ol className="scroll-fade -mx-4 flex overflow-x-auto px-4 scrollbar-hide md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0">
                {days.map((day) => (
                    <li
                        key={day.offset}
                        aria-label={`${day.weekday}${day.offset ? ` ${day.day}` : ''}: ${day.shows.length} of your shows`}
                        className={`w-[9.5rem] shrink-0 border-t-2 pt-3 pr-3 md:w-auto ${day.offset === 0 ? 'border-[var(--signature)]' : 'border-white/[0.08]'}`}
                    >
                        <p className="flex items-baseline gap-1.5 text-[15px]">
                            <span className={`font-semibold ${day.offset === 0 ? 'text-[var(--signature)]' : 'text-[var(--text-1)]'}`}>
                                {day.weekday}
                            </span>
                            {day.offset > 0 && <span className="text-[var(--text-3)] tabular">{day.day}</span>}
                        </p>
                        <ul className="mt-2 space-y-2">
                            {isPending ? (
                                <li><Skeleton className="h-9 w-full" /></li>
                            ) : day.shows.length === 0 ? (
                                <li className="text-sm text-[var(--text-3)]">—</li>
                            ) : (
                                day.shows.slice(0, 4).map((anime) => {
                                    const meta = statusMeta(anime.user_list_status?.status);
                                    const time = anime.next_airing_date
                                        ? formatDateTime(anime.next_airing_date, { hour: '2-digit', minute: '2-digit' }, timezone)
                                        : 'time tba';
                                    return (
                                        <li key={anime.id}>
                                            <Link to={`/anime/${anime.slug}`} className="group block min-h-9">
                                                <span className="flex items-center gap-1.5">
                                                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta?.color }} />
                                                    <span className="truncate text-sm text-[var(--text-1)] group-hover:text-[var(--signature)]">{anime.title}</span>
                                                </span>
                                                <span className="block pl-3 text-[13px] text-[var(--text-3)] tabular">
                                                    {anime.next_airing_episode ? `ep ${anime.next_airing_episode} · ` : ''}{time}
                                                </span>
                                            </Link>
                                        </li>
                                    );
                                })
                            )}
                            {day.shows.length > 4 && (
                                <li className="pl-3 text-[13px] text-[var(--text-3)]">+{day.shows.length - 4} more</li>
                            )}
                        </ul>
                    </li>
                ))}
            </ol>
        </section>
    );
}
