import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
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
        <section aria-labelledby="ribbon-heading" className="px-4 md:px-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-3 flex items-end justify-between gap-4">
                    <h2 id="ribbon-heading" className="section-title">Your week</h2>
                    <Link to="/schedule?mine=1" className="btn-ghost text-sm">
                        Schedule
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                </div>
                <ol className="scroll-fade -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0">
                    {days.map((day) => (
                        <li
                            key={day.offset}
                            aria-label={`${day.weekday}${day.offset ? ` ${day.day}` : ''}: ${day.shows.length} of your shows`}
                            className={`flex w-[8.5rem] shrink-0 flex-col rounded-[var(--radius-md)] p-2.5 md:w-auto ${day.offset === 0 ? 'bg-[var(--signature-soft)] ring-1 ring-[var(--signature-line)]' : 'bg-[var(--ink-1)]'}`}
                        >
                            <p className="flex items-baseline justify-between">
                                <span className={`font-display text-lg font-extrabold uppercase leading-none ${day.offset === 0 ? 'text-[var(--signature)]' : 'text-gray-200'}`}>
                                    {day.weekday}
                                </span>
                                <span className="text-xs text-gray-500 tabular">{day.day}</span>
                            </p>
                            <ul className="mt-2 space-y-1.5">
                                {isPending ? (
                                    <li><Skeleton className="h-9 w-full" /></li>
                                ) : day.shows.length === 0 ? (
                                    <li className="py-2 text-xs text-gray-600">Nothing on</li>
                                ) : (
                                    day.shows.slice(0, 4).map((anime) => {
                                        const meta = statusMeta(anime.user_list_status?.status);
                                        const time = anime.next_airing_date
                                            ? formatDateTime(anime.next_airing_date, { hour: '2-digit', minute: '2-digit' }, timezone)
                                            : 'TBA';
                                        return (
                                            <li key={anime.id}>
                                                <Link
                                                    to={`/anime/${anime.slug}`}
                                                    className="flex min-h-9 items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-white/[0.06]"
                                                >
                                                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta?.color }} />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium text-gray-100">{anime.title}</span>
                                                        <span className="block text-[11px] text-gray-500 tabular">
                                                            {anime.next_airing_episode ? `EP ${anime.next_airing_episode} · ` : ''}{time}
                                                        </span>
                                                    </span>
                                                </Link>
                                            </li>
                                        );
                                    })
                                )}
                                {day.shows.length > 4 && (
                                    <li className="px-1.5 text-[11px] text-gray-500">+{day.shows.length - 4} more</li>
                                )}
                            </ul>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
