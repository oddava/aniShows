import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../utils/imageUtils';
import Skeleton from '../components/ui/Skeleton';
import { LoadingBar } from '../components/LoadingBar';
import SEO from '../components/SEO';
import ErrorBoundary from '../components/ErrorBoundary';
import ErrorState from '../components/common/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import {
  bucketScheduleByDate,
  formatCalendarDate,
  formatCalendarRange,
  formatCountdown,
  formatDate,
  getZonedCalendarToday,
  hasAiringDate,
  resolveTimeZone,
} from '../utils/dateUtils';
import { scheduleQueries } from '../api/queries/anime';
import { hasSession } from '../api/httpClient';
import useActivePill from '../hooks/useActivePill';
import useSwitchFade from '../hooks/useSwitchFade';
import useNow from '../hooks/useNow';

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


// Day strip: the coming seven dates starting today (the schedule lists each
// show's *next* airing, so this is not a calendar week). Column `position` is
// the date today + position; its label and its count come from that same
// offset. Seven equal columns, so the strip fits on a phone without sideways
// scrolling. Counts stay blank until the schedule has loaded.
const DaySelector = ({ selectedDay, onSelect, animeCounts, todayDay, startOfToday, quietEmpty = false, loading = false }) => {
  const pill = useActivePill('[aria-pressed="true"]');
  return (
    <div ref={pill.hostRef} className="pill-host grid grid-cols-7 gap-1" role="group" aria-label="Day" style={{ '--pill-radius': 'var(--radius-md)', '--pill-bg': 'rgb(255 255 255 / 0.08)' }}>
      <span ref={pill.pillRef} aria-hidden="true" className="active-pill" />
      {Array.from({ length: 7 }, (_, position) => (todayDay + position) % 7).map((index, position) => {
        const isSelected = selectedDay === index;
        const count = animeCounts[position] || 0;
        const isToday = position === 0;
        const date = addDays(startOfToday, position);
        const dayOfMonth = formatCalendarDate(date, { day: 'numeric' });
        const dayLabel = isToday ? 'Today' : DAY_SHORT[index];
        const showCount = count > 0 || !quietEmpty;
        const countLabel = loading ? '' : showCount ? `${count} ep` : 'Free';
        const episodes = `${count} ${count === 1 ? 'episode' : 'episodes'}`;

        return (
          <button
            key={DAY_NAMES[index]}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={isSelected}
            aria-current={isToday ? 'date' : undefined}
            // The name starts with exactly what the button shows (WCAG 2.5.3,
            // so voice users can say it), then spells it out.
            aria-label={loading ? `${dayLabel} ${dayOfMonth} (${DAY_NAMES[index]})` : `${dayLabel} ${dayOfMonth} ${countLabel} (${DAY_NAMES[index]}, ${episodes})`}
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] px-1 py-1.5 transition-colors duration-200 ${isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
          >
            <span className={`max-w-full truncate text-xs font-medium sm:text-[13px] ${isSelected || isToday ? 'text-[var(--signature)]' : 'text-[var(--text-3)]'}`}>
              {dayLabel}
            </span>
            {' '}
            <span className={`text-base font-semibold leading-tight tabular sm:text-lg ${isSelected ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
              {dayOfMonth}
            </span>
            {' '}
            <span className={`min-h-4 text-[11px] tabular sm:text-xs ${count > 0 || isSelected ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}`}>
              {!loading && <span>{showCount ? count : 'Free'}</span>}
              {!loading && showCount ? ' ep' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// The strip stays at the top while a long day scrolls (styles/pages/schedule.css).
// A sentinel just above it says when it has stuck.
const StickyDays = ({ children }) => {
  const sentinelRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div data-stuck={stuck ? 'true' : undefined} className="schedule-days sticky top-0 z-30 -mx-4 mb-4 px-4 py-1.5 sm:mx-0 sm:px-0">
        {children}
      </div>
    </>
  );
};

// The members' "All / My list" switch.
const MyListToggle = ({ myListOnly, onToggle }) => {
  const pill = useActivePill();
  return (
    <div ref={pill.hostRef} role="group" aria-label="Show" className="pill-host flex shrink-0 rounded-lg bg-white/[0.04] p-0.5" style={{ '--pill-bg': 'rgb(255 255 255 / 0.1)', '--pill-radius': '0.375rem' }}>
      <span ref={pill.pillRef} aria-hidden="true" className="active-pill" />
      {[
        { id: 'all', label: 'All', active: !myListOnly },
        { id: 'mine', label: 'My list', active: myListOnly },
      ].map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.active}
          onClick={() => { if (!option.active) onToggle(); }}
          className={`flex h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 sm:px-4 ${option.active ? 'bg-white/[0.1] text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

const airingTime = (anime) => {
  const time = Date.parse(anime?.next_airing_date);
  return Number.isFinite(time) ? time : Infinity;
};

// "21:30" in the viewer's zone; null without a date.
const formatClock = (anime, preferredTimezone) => (hasAiringDate(anime)
  ? formatDate(anime.next_airing_date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, preferredTimezone) || null
  : null);

// 3 posters across on a phone, 8 on a wide screen: a typical day fits in two
// or three rows, with no reading needed to scan it.
const POSTER_GRID = 'grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8';

// A busy day splits into three parts, so 30 posters read as a few short runs.
// Quieter days stay one grid: headings there would only add reading.
const BAND_MIN = 16;
const BANDS = [
  { label: 'Before noon', until: 12 },
  { label: 'Afternoon', until: 17 },
  { label: 'Evening', until: 24 },
];

const bandsOf = (items, preferredTimezone) => {
  const bands = BANDS.map((band) => ({ ...band, items: [] }));
  items.forEach((anime) => {
    const hour = Number.parseInt(formatClock(anime, preferredTimezone), 10);
    const band = bands.find((b) => hour < b.until) || bands[bands.length - 1];
    band.items.push(anime);
  });
  return bands.filter((band) => band.items.length > 0);
};

// The day's posters while they load.
const AgendaSkeleton = () => (
  <div aria-hidden="true" data-testid="schedule-grid-skeleton" className={POSTER_GRID}>
    {Array.from({ length: 16 }, (_, i) => (
      <div key={i}>
        <Skeleton className="aspect-[2/3] w-full" rounded="rounded-[var(--radius-md)]" />
        <Skeleton className="mt-2.5 h-3.5 w-4/5" />
        <Skeleton className="mt-1.5 h-3 w-1/2" />
      </div>
    ))}
  </div>
);

// "Ep 10 · in 1h 16m" / "Ep 9 · out now" under a poster. Countdowns only for
// today and tomorrow; further out the time on the cover says enough.
const episodeLine = (anime, { untimed, now, showCountdown }) => {
  const ep = anime.next_airing_episode ? `Ep ${anime.next_airing_episode}` : 'New episode';
  if (untimed) return ep;
  const left = formatCountdown(anime.next_airing_date, now);
  if (left === 'aired') return `${ep} · out now`;
  return showCountdown && left ? `${ep} · in ${left}` : ep;
};

// One poster per episode in air-time order: the time on the cover (in the
// accent colour for a show on your list), episode and countdown under the
// title. Episodes already out keep readable text; only their artwork fades.
const PosterGrid = ({ items, preferredTimezone, now, showCountdown = false, untimed = false, faded = false }) => (
  <div className={`${POSTER_GRID} ${faded ? '[&_img]:opacity-50' : ''}`}>
    {items.map((anime, index) => (
      <AnimeCard
        key={anime.id}
        anime={anime}
        priority={index < 6}
        index={index}
        metaText={episodeLine(anime, { untimed, now, showCountdown })}
        cornerLabel={untimed ? null : formatClock(anime, preferredTimezone)}
        cornerAccent={isOnMyList(anime)}
      />
    ))}
  </div>
);

// A part of the day on a busy day: a quiet label over its posters.
const BandedGrid = ({ items, preferredTimezone, now, showCountdown }) => {
  if (items.length < BAND_MIN) {
    return <PosterGrid items={items} preferredTimezone={preferredTimezone} now={now} showCountdown={showCountdown} />;
  }
  return (
    <div className="flex flex-col gap-7">
      {bandsOf(items, preferredTimezone).map((band) => (
        <section key={band.label} aria-label={band.label}>
          <h3 className="mb-3 text-sm font-medium text-[var(--text-2)]">{band.label}</h3>
          <PosterGrid items={band.items} preferredTimezone={preferredTimezone} now={now} showCountdown={showCountdown} />
        </section>
      ))}
    </div>
  );
};

// A collapsed run of posters behind one line ("3 more · time not announced").
const Disclosure = ({ label, open = false, children }) => (
  <details className="group/more" open={open}>
    <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] [&::-webkit-details-marker]:hidden">
      {label}
      <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-open/more:rotate-180" />
    </summary>
    <div className="mt-3">{children}</div>
  </details>
);

// "Up next": the member's shows this week, one compact row each. A phone
// shows the nearest one and wider screens one row of them; "Show all" lists
// the rest. Classes per position, so the first paint needs no measuring.
const UP_NEXT_VISIBILITY = ['flex', 'hidden sm:flex', 'hidden lg:flex', 'hidden xl:flex'];
// Where every row already fits, the "Show all" button has nothing to show.
const showAllVisibility = (count) => (count <= 1 ? 'hidden' : count === 2 ? 'sm:hidden' : count === 3 ? 'lg:hidden' : count === 4 ? 'xl:hidden' : '');
const UP_NEXT_ROW = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

const UpNextCard = ({ anime, offset, startOfToday, preferredTimezone, now, eager }) => {
  const date = addDays(startOfToday, offset);
  const day = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : DAY_SHORT[date.getUTCDay()];
  const time = formatClock(anime, preferredTimezone);
  const left = formatCountdown(anime.next_airing_date, now);
  const isOut = left === 'aired';
  const cover = getOptimizedImageUrl(anime, 'cover', 'small');
  const fallback = getImageFallbackUrl(anime, 'cover');
  return (
    <Link
      to={`/anime/${anime.slug}`}
      className="flex h-full items-center gap-3 rounded-[var(--radius-md)] bg-[var(--ink-1)] p-2 pr-3 transition-colors duration-150 hover:bg-[var(--ink-2)]"
    >
      <span className="block h-14 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--ink-2)]">
        {cover && <img src={cover} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={(e) => applyImageFallback(e, fallback)} className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--text-1)]">{anime.title}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--text-2)] tabular">
          {anime.next_airing_episode ? `Ep ${anime.next_airing_episode}` : 'New episode'}
          {` · ${day}`}
          {time ? ` ${time}` : ''}
        </span>
      </span>
      <span className={`shrink-0 text-sm font-semibold tabular ${isOut ? 'text-[var(--status-watching)]' : 'text-[var(--signature)]'}`}>
        {isOut ? 'Out now' : left ? `in ${left}` : 'TBA'}
      </span>
    </Link>
  );
};

const UpNext = ({ isAuthenticated, isLoading, items, startOfToday, preferredTimezone, now }) => {
  const [expanded, setExpanded] = useState(false);
  if (!isAuthenticated) {
    return (
      <p className="text-sm text-[var(--text-2)]">
        Your own shows lead the schedule once you{' '}
        <Link to="/login" className="text-link">sign in</Link>
        {' '}or{' '}
        <Link to="/register" className="text-link">create an account</Link>.
      </p>
    );
  }
  if (isLoading) {
    return (
      <div aria-hidden="true">
        <Skeleton className="mb-3 h-5 w-40" />
        <div className={UP_NEXT_ROW}>
          {UP_NEXT_VISIBILITY.map((visibility, i) => (
            <Skeleton key={i} className={`${visibility} h-[72px]`} rounded="rounded-[var(--radius-md)]" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--text-1)]">Up next on your list</h2>
        {items.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className={`text-link min-h-8 text-sm ${showAllVisibility(items.length)}`}
          >
            {expanded ? 'Show less' : `Show all ${items.length}`}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-2)]">Nothing on your list airs in the next 7 days.</p>
      ) : (
        <ul className={UP_NEXT_ROW}>
          {items.map(({ offset, anime }, index) => (
            <li key={`${offset}-${anime.id}`} className={expanded ? 'flex' : (UP_NEXT_VISIBILITY[index] || 'hidden')}>
              <div className="w-full">
                <UpNextCard
                  anime={anime}
                  offset={offset}
                  startOfToday={startOfToday}
                  preferredTimezone={preferredTimezone}
                  now={now}
                  eager={index < 4}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

// Main Schedule Page Component
export default function Schedule() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const adultContentEnabled = Boolean(user?.show_adult_content);
  const preferredTimezone = user?.preferred_timezone;
  const timezoneLabel = useMemo(() => getTimezoneLabel(preferredTimezone), [preferredTimezone]);
  // One clock for the page: countdowns, "out now" and what is still to come
  // all move on together, once a minute.
  const now = useNow();

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

  // Up next: the member's shows this week, soonest first. Shows already out
  // today stay (as "Out now").
  const upNext = useMemo(() => {
    if (!isAuthenticated) return [];
    const { days } = bucketScheduleByDate(filterMyList(rawScheduleDays), preferredTimezone);
    return days.flatMap((items, offset) => [...items]
      .sort((a, b) => airingTime(a) - airingTime(b))
      .map((anime) => ({ offset, anime })));
  }, [isAuthenticated, rawScheduleDays, preferredTimezone]);

  const animeCounts = useMemo(
    () => scheduleByOffset.map((items) => items.length),
    [scheduleByOffset]
  );

  const selectedDayAnime = scheduleByOffset[selectedOffset] || [];
  // One keyed wrapper for the day's agenda or its empty state: every day or
  // My list switch fades in the same way, and the first paint does not fade.
  const dayKey = `${selectedDay}-${myListOnly ? 'mine' : 'all'}`;
  const dayFade = useSwitchFade(dayKey);
  // Episodes already out today stay folded behind a toggle in the day's heading.
  const [showAired, setShowAired] = useState(false);

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

  // The day in three runs: still to come (what matters), already out (folded
  // behind the heading's toggle, unless that is all there is) and no time
  // announced yet (folded at the end).
  const timed = selectedDayAnime.filter((anime) => airingTime(anime) !== Infinity);
  const untimed = selectedDayAnime.filter((anime) => airingTime(anime) === Infinity);
  const upcoming = timed.filter((anime) => airingTime(anime) >= now);
  const aired = timed.filter((anime) => airingTime(anime) < now);
  const showCountdown = selectedOffset <= 1;
  const airedOpen = showAired || upcoming.length === 0;
  // Shown while a member's session restores too, so the header keeps its height.
  const memberView = isAuthenticated || (authLoading && hasSession());

  return (
    <ErrorBoundary>
      <SEO page="schedule" />
      <LoadingBar isLoading={isLoading || isFetching} />
      <div className="min-h-screen pb-20">
        <div className="page-container py-5 sm:py-8">
          <header className="mb-5 sm:mb-6">
            <div className="flex items-center justify-between gap-4">
              <h1 className="page-title min-w-0 max-sm:text-2xl">Airing schedule</h1>
              {memberView && (
                <MyListToggle myListOnly={myListOnly} onToggle={() => setMyListParam(!myListOnly)} />
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--text-2)] tabular sm:mt-2">
              {formatCalendarRange(startOfToday, addDays(startOfToday, 6))}
              {' · '}
              Times in {timezoneLabel}
            </p>
          </header>

          {/* With My list on, the day below already is your list. */}
          {!myListOnly && (
            <aside aria-label="Your week" className="mb-4 sm:mb-6">
              <UpNext
                isAuthenticated={memberView}
                isLoading={isLoading || authLoading}
                items={upNext}
                startOfToday={startOfToday}
                preferredTimezone={preferredTimezone}
                now={now}
              />
            </aside>
          )}

          <StickyDays>
            <DaySelector
              quietEmpty={myListOnly}
              selectedDay={selectedDay}
              onSelect={setSelectedDay}
              animeCounts={animeCounts}
              todayDay={todayDayIndex}
              startOfToday={startOfToday}
              loading={isLoading}
            />
          </StickyDays>

          <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--text-1)]">
              {DAY_NAMES[selectedDay]}
              <span className="ml-1.5 font-normal text-[var(--text-2)]">
                {formatCalendarDate(addDays(startOfToday, selectedOffset), { day: 'numeric', month: 'short' })}
              </span>
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {!isLoading && aired.length > 0 && upcoming.length > 0 && (
                <button
                  type="button"
                  aria-expanded={showAired}
                  aria-controls="schedule-aired"
                  onClick={() => setShowAired(!showAired)}
                  className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm text-[var(--text-2)] transition-colors duration-150 hover:text-[var(--text-1)]"
                >
                  Aired · {aired.length}
                  <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 ${showAired ? 'rotate-180' : ''}`} />
                </button>
              )}
              {selectedDay !== todayDayIndex && (
                <button type="button" onClick={handleToday} className="btn-ghost min-h-10 whitespace-nowrap px-3 py-0 text-sm">
                  Back to today
                </button>
              )}
            </div>
          </div>

          {isLoading ? (
            <AgendaSkeleton />
          ) : (
            <div key={dayKey} className={dayFade}>
              {selectedDayAnime.length === 0 ? (
                <EmptyState title="No episodes scheduled">
                  {myListOnly
                    ? `Nothing from your list airs on ${DAY_NAMES[selectedDay]}.`
                    : `There are no anime episodes airing on ${DAY_NAMES[selectedDay]}.`}
                  {' '}Try another day in the strip above.
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-6 [&>[hidden]]:hidden">
                  {aired.length > 0 && (
                    <div id="schedule-aired" hidden={!airedOpen}>
                      <PosterGrid items={aired} preferredTimezone={preferredTimezone} now={now} faded />
                    </div>
                  )}
                  {upcoming.length > 0 && (
                    <BandedGrid items={upcoming} preferredTimezone={preferredTimezone} now={now} showCountdown={showCountdown} />
                  )}
                  {untimed.length > 0 && (timed.length > 0 ? (
                    <Disclosure label={`${untimed.length} more · time not announced`}>
                      <PosterGrid items={untimed} preferredTimezone={preferredTimezone} now={now} untimed />
                    </Disclosure>
                  ) : (
                    <section aria-label="Time not announced">
                      <h3 className="mb-3 text-sm font-medium text-[var(--text-2)]">Time not announced</h3>
                      <PosterGrid items={untimed} preferredTimezone={preferredTimezone} now={now} untimed />
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isLoading && laterCount > 0 && (
            <p className="mt-8 text-sm text-[var(--text-3)]">
              {laterCount} more {laterCount === 1 ? 'airs' : 'air'} later
            </p>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
