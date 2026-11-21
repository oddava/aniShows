import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import { ScheduleGridSkeleton } from '../components/skeletons';
import { LoadingBar } from '../components/LoadingBar';
import SEO from '../components/SEO';
import ErrorBoundary from '../components/ErrorBoundary';
import ErrorState from '../components/common/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import {
  bucketScheduleByDate,
  formatCalendarDate,
  formatDate,
  getZonedCalendarToday,
  hasAiringDate,
  resolveTimeZone,
} from '../utils/dateUtils';
import { scheduleQueries } from '../api/queries/anime';

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Statuses that leave a show out of "My list" (finished or given up on).
const MY_LIST_EXCLUDED_STATUSES = new Set(['dropped', 'completed']);

const isOnMyList = (anime) => {
  const status = anime?.user_list_status?.status;
  return Boolean(status) && !MY_LIST_EXCLUDED_STATUSES.has(String(status).toLowerCase());
};

const filterMyList = (daysPayload) => Object.fromEntries(
  Object.entries(daysPayload || {}).map(([day, items]) => [
    day,
    Array.isArray(items) ? items.filter(isOnMyList) : items,
  ])
);

// "Airs 21:30" / "Aired 09:00" in the viewer's zone; "Time TBA" without a date.
const formatAirTime = (anime, preferredTimezone) => {
  if (!hasAiringDate(anime)) return 'Time TBA';
  const time = formatDate(anime.next_airing_date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, preferredTimezone);
  if (!time) return null;
  return new Date(anime.next_airing_date) < new Date() ? `Aired ${time}` : `Airs ${time}`;
};

const getTimezoneLabel = (preferredTimezone) => {
  try {
    const zone = resolveTimeZone(preferredTimezone);
    return zone ? zone.replace(/_/g, ' ') : 'local time';
  } catch {
    return 'local time';
  }
};

// Calendar-day arithmetic on the UTC-anchored dates from getZonedCalendarToday.
const addDays = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};


// Day Selector Component
// The schedule lists each show's *next* airing, so the strip is the coming
// seven dates starting today, not a calendar week. Column `position` is the
// date today + position; its label and its count come from that same offset.
// Seven equal columns, so the whole strip fits on a phone without sideways
// scrolling.
const DaySelector = ({ selectedDay, onSelect, animeCounts, todayDay, startOfToday }) => {
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Day">
      {Array.from({ length: 7 }, (_, position) => (todayDay + position) % 7).map((index, position) => {
        const isSelected = selectedDay === index;
        const count = animeCounts[position] || 0;
        const isToday = position === 0;
        const date = addDays(startOfToday, position);
        const dayOfMonth = formatCalendarDate(date, { day: 'numeric' });

        return (
          <button
            key={DAY_NAMES[index]}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={isSelected}
            aria-current={isToday ? 'date' : undefined}
            aria-label={`${DAY_NAMES[index]} ${dayOfMonth}, ${count} ${count === 1 ? 'episode' : 'episodes'}`}
            className={`relative flex min-h-16 flex-col items-start rounded-[var(--radius-md)] px-2 py-2.5 text-left transition-colors duration-200 sm:px-3 ${isSelected
              ? 'bg-white/[0.08]'
              : 'hover:bg-white/[0.04]'}`}
          >
            <span className={`text-sm font-semibold ${isSelected || isToday ? 'text-[var(--signature)]' : 'text-[var(--text-2)]'}`}>
              {isToday ? 'Today' : DAY_SHORT[index]}
            </span>
            <span className={`text-lg font-semibold leading-tight tabular ${isSelected ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
              {dayOfMonth}
            </span>
            <span aria-hidden="true" className={`text-xs tabular ${count > 0 ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}`}>
              <span>{count}</span> ep
            </span>
          </button>
        );
      })}
    </div>
  );
};

// Range line: the dates the strip covers, the members' "My list" filter and a
// shortcut back to today.
const RangeHeader = ({ startOfToday, onToday, isTodaySelected, showMyListToggle, myListOnly, onToggleMyList }) => {
  const end = addDays(startOfToday, 6);

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="whitespace-nowrap font-semibold text-[var(--text-1)] tabular">
        Next 7 days
        <span className="ml-2 font-normal text-[var(--text-2)]">
          {formatCalendarDate(startOfToday, { month: 'short', day: 'numeric' })}
          {' – '}
          {formatCalendarDate(end, { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!isTodaySelected && (
          <button
            type="button"
            onClick={onToday}
            className="btn-ghost min-h-11 whitespace-nowrap px-4 py-0 text-sm"
          >
            Back to today
          </button>
        )}
        {showMyListToggle && (
          <div role="group" aria-label="Show" className="flex rounded-lg bg-white/[0.04] p-0.5">
            {[
              { id: 'all', label: 'All', active: !myListOnly },
              { id: 'mine', label: 'My list', active: myListOnly },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.active}
                onClick={() => { if (!option.active) onToggleMyList(); }}
                className={`flex h-10 items-center whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors duration-150 ${option.active ? 'bg-white/[0.1] text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// The selected day as an agenda: in time order, shows without a time last;
// members see their own shows first.
const airingTime = (anime) => {
  const time = Date.parse(anime?.next_airing_date);
  return Number.isFinite(time) ? time : Infinity;
};

const agendaGroups = (items, isAuthenticated) => {
  const sorted = [...items].sort((a, b) => airingTime(a) - airingTime(b));
  const mine = isAuthenticated ? sorted.filter(isOnMyList) : [];
  const rest = isAuthenticated ? sorted.filter((anime) => !isOnMyList(anime)) : sorted;
  const timed = rest.filter((anime) => airingTime(anime) !== Infinity);
  const untimed = rest.filter((anime) => airingTime(anime) === Infinity);
  const groups = [
    { title: 'On your list', items: mine },
    { title: mine.length ? 'Also airing' : 'Airing', items: timed },
    { title: 'Time not announced', items: untimed, untimed: true },
  ].filter((group) => group.items.length > 0);
  return groups.map((group) => ({ ...group, showTitle: groups.length > 1 || group.untimed }));
};

// The side column: every show on your list that airs this week, by day.
// A row selects its day. Guests get one line on why to sign in.
const WeekAside = ({ isAuthenticated, isLoading, items, startOfToday, selectedOffset, preferredTimezone, onSelectDay }) => {
  if (!isAuthenticated) {
    return (
      <div className="panel">
        <h2 className="text-[15px] font-semibold text-[var(--text-1)]">Your shows, first</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">
          Sign in and the shows on your list lead each day, with a reminder when a new episode is out.
        </p>
        <Link to="/register" className="text-link mt-1 text-sm">Create an account</Link>
      </div>
    );
  }
  if (isLoading) return null;
  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold text-[var(--text-1)]">On your list this week</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">
          Nothing on your list airs in the next 7 days.
        </p>
      ) : (
        <ul className="-mx-2 mt-2">
          {items.map(({ offset, anime }) => {
            const date = addDays(startOfToday, offset);
            const day = offset === 0 ? 'Today' : DAY_SHORT[date.getUTCDay()];
            const time = hasAiringDate(anime)
              ? formatDate(anime.next_airing_date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, preferredTimezone)
              : null;
            const active = offset === selectedOffset;
            return (
              <li key={`${offset}-${anime.id}`}>
                <button
                  type="button"
                  onClick={() => onSelectDay(offset)}
                  className={`flex min-h-11 w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 ${active ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}
                >
                  <span className={`w-12 shrink-0 text-sm tabular ${offset === 0 ? 'text-[var(--signature)]' : 'text-[var(--text-2)]'}`}>{day}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text-1)]">{anime.title}</span>
                    <span className="block text-xs text-[var(--text-3)] tabular">
                      {anime.next_airing_episode ? `Ep ${anime.next_airing_episode}` : 'New episode'}
                      {time ? ` · ${time}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// Main Schedule Page Component
export default function Schedule() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, user } = useAuth();
  const adultContentEnabled = Boolean(user?.show_adult_content);
  const preferredTimezone = user?.preferred_timezone;
  const timezoneLabel = useMemo(() => getTimezoneLabel(preferredTimezone), [preferredTimezone]);

  // Today as a calendar date in the same zone the schedule is grouped by.
  const startOfToday = useMemo(() => getZonedCalendarToday(preferredTimezone), [preferredTimezone]);
  const todayDayIndex = startOfToday.getUTCDay();

  // The selected column is kept as a weekday (so `?day=friday` links keep
  // working); the strip holds each weekday exactly once, so it maps to one date.
  const [selectedDay, setSelectedDay] = useState(() => {
    const dayParam = searchParams.get('day');
    const dayIndex = dayParam
      ? DAY_NAMES.findIndex(d => d.toLowerCase() === dayParam.toLowerCase())
      : -1;
    return dayIndex !== -1 ? dayIndex : todayDayIndex;
  });
  const selectedOffset = (selectedDay - todayDayIndex + 7) % 7;

  // "My list" (members only): kept in state so the URL flag survives the
  // moment before the session is known.
  const [myListParam, setMyListParam] = useState(() => searchParams.get('mine') === '1');
  const myListOnly = isAuthenticated && myListParam;

  // Keep the selected day (and My list) in the URL so they survive reloads and can be shared.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('day', DAY_NAMES[selectedDay].toLowerCase());
    if (myListOnly) params.set('mine', '1');
    setSearchParams(params, { replace: true });
  }, [selectedDay, myListOnly, setSearchParams]);

  // Fetch schedule data
  const { data: rawScheduleDays, isLoading, isFetching, error, refetch } = useQuery({
    ...scheduleQueries.week(isAuthenticated, adultContentEnabled),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Seven date buckets (index = days from today) plus the count airing later.
  const { days: scheduleByOffset, laterCount } = useMemo(
    () => bucketScheduleByDate(
      myListOnly ? filterMyList(rawScheduleDays) : rawScheduleDays,
      preferredTimezone
    ),
    [rawScheduleDays, preferredTimezone, myListOnly]
  );

  const myWeek = useMemo(() => {
    if (!isAuthenticated) return [];
    const { days } = bucketScheduleByDate(filterMyList(rawScheduleDays), preferredTimezone);
    return days.flatMap((items, offset) => items.map((anime) => ({ offset, anime })));
  }, [isAuthenticated, rawScheduleDays, preferredTimezone]);

  const animeCounts = useMemo(
    () => scheduleByOffset.map((items) => items.length),
    [scheduleByOffset]
  );

  const selectedDayAnime = scheduleByOffset[selectedOffset] || [];

  const handleToday = () => {
    setSelectedDay(todayDayIndex);
  };

  if (error) {
    return (
      <ErrorBoundary>
        <SEO page="schedule" />
        <div className="page-container py-10">
          <ErrorState
            title="Failed to load schedule"
            message="This week’s airing times didn’t load. Try again in a moment."
            onRetry={() => refetch()}
          />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SEO page="schedule" />
      <LoadingBar isLoading={isLoading || isFetching} />
      <div className="min-h-screen pb-20">
        {/* Main Content */}
        <div className="page-container py-6 sm:py-8">
          <header className="mb-6">
            <h1 className="page-title">Airing schedule</h1>
            <p className="mt-2 text-[15px] text-[var(--text-2)]">
              Times are in your time zone ({timezoneLabel}).
            </p>
          </header>

          {/* Week Navigator */}
          <RangeHeader
            startOfToday={startOfToday}
            onToday={handleToday}
            isTodaySelected={selectedDay === todayDayIndex}
            showMyListToggle={isAuthenticated}
            myListOnly={myListOnly}
            onToggleMyList={() => setMyListParam(!myListOnly)}
          />

          {/* Day Selector */}
          <div className="mb-8 sm:mb-10">
            <DaySelector
              selectedDay={selectedDay}
              onSelect={setSelectedDay}
              animeCounts={animeCounts}
              todayDay={todayDayIndex}
              startOfToday={startOfToday}
            />
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <div className="min-w-0">
          {/* Selected Day Header */}
          <div className="flex items-center justify-between gap-3 mb-5 sm:mb-6">
            <h2 className="section-title">
              {DAY_NAMES[selectedDay]}
              <span className="ml-2 font-normal text-[var(--text-2)]">
                {formatCalendarDate(
                  addDays(startOfToday, selectedOffset),
                  { month: 'short', day: 'numeric' }
                )}
              </span>
            </h2>

            <div className="flex items-center gap-3">
              <div className="text-sm text-[var(--text-2)]">
                {selectedDayAnime.length} {selectedDayAnime.length === 1 ? 'episode' : 'episodes'}
              </div>
            </div>
          </div>

          {/* Anime Grid */}
          {isLoading ? (
            <ScheduleGridSkeleton count={10} />
          ) : selectedDayAnime.length > 0 ? (
            <div className="flex flex-col gap-4">
              {agendaGroups(selectedDayAnime, isAuthenticated).map((group) => (
                <section key={group.title} aria-label={group.title} className="panel">
                  {group.showTitle && (
                    <h3 className="mb-1 flex items-baseline gap-2 text-[15px] font-semibold text-[var(--text-2)]">
                      {group.title}
                      <span className="text-sm font-normal text-[var(--text-3)] tabular">{group.items.length}</span>
                    </h3>
                  )}
                  <div>
                    {group.items.map((anime, index) => (
                      <AnimeCard
                        key={anime.id}
                        variant="row"
                        anime={anime}
                        priority={index < 6}
                        index={index}
                        showAiringCountdown
                        metaText={group.untimed ? null : formatAirTime(anime, preferredTimezone)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState title="No episodes scheduled">
              {myListOnly
                ? `Nothing from your list airs on ${DAY_NAMES[selectedDay]}.`
                : `There are no anime episodes airing on ${DAY_NAMES[selectedDay]}.`}
              {' '}Try another day in the strip above.
            </EmptyState>
          )}

          {!isLoading && laterCount > 0 && (
            <p className="mt-8 text-sm text-gray-500">
              {laterCount} more {laterCount === 1 ? 'airs' : 'air'} later
            </p>
          )}
          </div>

          <aside aria-label="Your week" className="lg:pt-[3.75rem]">
            <WeekAside
              isAuthenticated={isAuthenticated}
              isLoading={isLoading}
              items={myWeek}
              startOfToday={startOfToday}
              selectedOffset={selectedOffset}
              preferredTimezone={preferredTimezone}
              onSelectDay={(offset) => setSelectedDay((todayDayIndex + offset) % 7)}
            />
          </aside>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
