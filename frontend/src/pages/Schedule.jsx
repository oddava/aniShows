import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Eye,
  EyeOff,
} from 'lucide-react';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import { ScheduleGridSkeleton } from '../components/skeletons';
import { LoadingBar } from '../components/LoadingBar';
import SEO from '../components/SEO';
import ErrorBoundary from '../components/ErrorBoundary';
import ErrorState from '../components/common/ErrorState';
import {
  bucketScheduleByDate,
  formatCalendarDate,
  formatDate,
  getZonedCalendarToday,
  hasAiringDate,
  resolveTimeZone,
} from '../utils/dateUtils';
import { animeKeys, scheduleKeys, scheduleQueries } from '../api/queries/anime';
import { profileKeys } from '../api/queries/user';

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
    <div className="grid grid-cols-7" role="group" aria-label="Day">
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
            className={`relative flex min-h-16 flex-col items-start border-t-2 px-1 pt-2.5 pb-2 text-left transition-colors duration-200 sm:px-2 ${isSelected
              ? 'border-[var(--signature)]'
              : 'border-white/[0.08] hover:border-white/20'}`}
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
        {showMyListToggle && (
          <button
            type="button"
            onClick={onToggleMyList}
            aria-pressed={myListOnly}
            className={`btn-secondary min-h-11 whitespace-nowrap px-4 py-0 text-sm ${myListOnly ? '!border-[var(--signature)] !text-[var(--text-1)]' : ''}`}
          >
            My list
          </button>
        )}
        <button
          type="button"
          onClick={onToday}
          disabled={isTodaySelected}
          className="btn-secondary min-h-11 whitespace-nowrap px-4 py-0 text-sm disabled:opacity-40 disabled:cursor-default"
        >
          Today
        </button>
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
  if (!isAuthenticated) return [{ title: 'Airing', items: sorted, showTitle: false }];
  const mine = sorted.filter(isOnMyList);
  const rest = sorted.filter((anime) => !isOnMyList(anime));
  if (mine.length === 0 || rest.length === 0) return [{ title: 'Airing', items: sorted, showTitle: false }];
  return [
    { title: 'On your list', items: mine, showTitle: true },
    { title: 'Also airing', items: rest, showTitle: true },
  ];
};

// Main Schedule Page Component
export default function Schedule() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isAuthenticated, user, refreshProfile } = useAuth();
  const adultContentEnabled = Boolean(user?.show_adult_content);
  const [isUpdatingAdultContent, setIsUpdatingAdultContent] = useState(false);
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

  const handleToggleAdultContent = useCallback(async () => {
    if (!isAuthenticated || isUpdatingAdultContent) return;

    const nextValue = !adultContentEnabled;
    setIsUpdatingAdultContent(true);
    try {
      const response = await authApi.updateProfile({ show_adult_content: nextValue });
      const updatedProfile = response?.data;
      if (updatedProfile && typeof updatedProfile === 'object') {
        await refreshProfile(updatedProfile);
        queryClient.setQueryData(profileKeys.own, updatedProfile);
      } else {
        await refreshProfile();
      }
      queryClient.removeQueries({ queryKey: scheduleKeys.all });
      queryClient.removeQueries({ queryKey: animeKeys.all });
      queryClient.invalidateQueries({ queryKey: profileKeys.own });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    } finally {
      setIsUpdatingAdultContent(false);
    }
  }, [
    adultContentEnabled,
    isAuthenticated,
    isUpdatingAdultContent,
    queryClient,
    refreshProfile,
  ]);

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
              {/* Members only: guests would just see a disabled control. */}
              {isAuthenticated && (
              <button
                onClick={handleToggleAdultContent}
                type="button"
                disabled={isUpdatingAdultContent}
                className={`flex items-center justify-center w-11 h-11 rounded-lg transition-colors ${
                  adultContentEnabled
                    ? 'bg-[var(--signature-soft)] text-[var(--signature)]'
                    : 'text-[var(--text-2)] hover:bg-white/[0.06] hover:text-white'
                } ${!isAuthenticated || isUpdatingAdultContent ? 'opacity-60 cursor-not-allowed' : ''}`}
                aria-label="Show explicit content"
                aria-pressed={adultContentEnabled}
                title={
                  !isAuthenticated
                    ? 'Log in to change explicit content visibility'
                    : adultContentEnabled
                      ? 'Explicit hentai: visible'
                      : 'Explicit hentai: hidden'
                }
              >
                {adultContentEnabled ? <Eye aria-hidden="true" className="w-[18px] h-[18px]" /> : <EyeOff aria-hidden="true" className="w-[18px] h-[18px]" />}
              </button>
              )}
            </div>
          </div>

          {/* Anime Grid */}
          {isLoading ? (
            <ScheduleGridSkeleton count={10} />
          ) : selectedDayAnime.length > 0 ? (
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
              {agendaGroups(selectedDayAnime, isAuthenticated).map((group) => (
                <section key={group.title} aria-label={group.title}>
                  {group.showTitle && <h3 className="mb-1 text-[15px] font-semibold text-[var(--text-2)]">{group.title}</h3>}
                  <div>
                    {group.items.map((anime, index) => (
                      <AnimeCard
                        key={anime.id}
                        variant="row"
                        anime={anime}
                        priority={index < 6}
                        index={index}
                        showAiringCountdown
                        metaText={formatAirTime(anime, preferredTimezone)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="ui-empty-state">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-dark-200 mb-5">
                <Bell aria-hidden="true" className="w-6 h-6 text-gray-500" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                No episodes scheduled
              </h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto">
                {myListOnly
                  ? `Nothing from your list airs on ${DAY_NAMES[selectedDay]}.`
                  : `There are no anime episodes airing on ${DAY_NAMES[selectedDay]}.`}
                {' '}Try another day in the strip above.
              </p>
            </div>
          )}

          {!isLoading && laterCount > 0 && (
            <p className="mt-8 text-sm text-gray-500">
              {laterCount} more {laterCount === 1 ? 'airs' : 'air'} later
            </p>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
