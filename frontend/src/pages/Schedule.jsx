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
  formatCalendarDate,
  formatDate,
  getCurrentWeekdayIndex,
  getZonedCalendarToday,
  resolveTimeZone,
  groupScheduleDaysByTimezone,
} from '../utils/dateUtils';
import { animeKeys, scheduleKeys, scheduleQueries } from '../api/queries/anime';
import { profileKeys } from '../api/queries/user';

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "21:30" in the viewer's zone, from the next airing time (or the broadcast slot).
const formatAirTime = (anime, preferredTimezone) => {
  if (anime?.next_airing_date) {
    const time = formatDate(anime.next_airing_date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, preferredTimezone);
    if (time) return `Airs ${time}`;
  }
  return null;
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
// seven days starting today, not a calendar week. Seven equal columns, so the
// whole strip fits on a phone without sideways scrolling.
const DaySelector = ({ selectedDay, onSelect, animeCounts, todayDay, startOfToday, preferredTimezone }) => {
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2" role="group" aria-label="Day">
      {Array.from({ length: 7 }, (_, position) => (todayDay + position) % 7).map((index, position) => {
        const isSelected = selectedDay === index;
        const count = animeCounts[index] || 0;
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
            className={`
              relative flex flex-col items-center rounded-xl border py-2 sm:py-2.5 transition-colors duration-200
              ${isSelected
                ? 'bg-accent-dark border-transparent text-white'
                : `bg-dark-100 text-gray-400 hover:text-white hover:border-gray-700 ${isToday ? 'border-accent/40' : 'border-gray-800'}`
              }
            `}
          >
            <span className={`text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-wider ${isSelected ? 'text-white/80' : isToday ? 'text-accent-light' : ''}`}>
              {DAY_SHORT[index]}
            </span>
            <span className={`text-base sm:text-lg font-bold leading-tight tabular ${isSelected ? 'text-white' : 'text-gray-200'}`}>
              {dayOfMonth}
            </span>
            <span aria-hidden="true" className={`mt-0.5 text-[11px] tabular ${isSelected ? 'text-white/80' : count > 0 ? 'text-gray-400' : 'text-gray-600'}`}>
              <span>{count}</span> ep
            </span>
          </button>
        );
      })}
    </div>
  );
};

// Range line: the dates the strip covers, and a shortcut back to today.
const RangeHeader = ({ startOfToday, onToday, isTodaySelected }) => {
  const end = addDays(startOfToday, 6);

  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="text-white font-semibold tabular">
        Next 7 days
        <span className="ml-2 font-normal text-gray-500">
          {formatCalendarDate(startOfToday, { month: 'short', day: 'numeric' })}
          {' – '}
          {formatCalendarDate(end, { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <button
        type="button"
        onClick={onToday}
        disabled={isTodaySelected}
        className="ui-pill-button h-9 py-0 disabled:opacity-40 disabled:cursor-default disabled:hover:text-gray-300"
      >
        Today
      </button>
    </div>
  );
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
  const todayDayIndex = useMemo(
    () => getCurrentWeekdayIndex(preferredTimezone),
    [preferredTimezone]
  );

  // Today as a calendar date in the same zone the schedule is grouped by.
  const startOfToday = useMemo(() => getZonedCalendarToday(preferredTimezone), [preferredTimezone]);

  // Get initial day from URL or use today
  const [selectedDay, setSelectedDay] = useState(() => {
    const dayParam = searchParams.get('day');
    if (dayParam) {
      const dayIndex = DAY_NAMES.findIndex(d => d.toLowerCase() === dayParam.toLowerCase());
      return dayIndex !== -1 ? dayIndex : getCurrentWeekdayIndex(preferredTimezone);
    }
    return getCurrentWeekdayIndex(preferredTimezone);
  });



  // Keep the selected day in the URL so it survives reloads and can be shared.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('day', DAY_NAMES[selectedDay].toLowerCase());
    setSearchParams(params, { replace: true });
  }, [selectedDay, setSearchParams]);

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

  const groupedScheduleDays = useMemo(
    () => groupScheduleDaysByTimezone(rawScheduleDays, preferredTimezone),
    [rawScheduleDays, preferredTimezone]
  );

  // Calculate anime counts per day
  const animeCounts = useMemo(() => {
    return DAY_NAMES.map((day) => groupedScheduleDays[day.toLowerCase()]?.length || 0);
  }, [groupedScheduleDays]);

  // Get anime for selected day
  const selectedDayAnime = useMemo(() => {
    return groupedScheduleDays[DAY_NAMES[selectedDay].toLowerCase()] || [];
  }, [groupedScheduleDays, selectedDay]);

  const handleToday = () => {
    setSelectedDay(getCurrentWeekdayIndex(preferredTimezone));
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
            <h1 className="page-title">Airing Schedule</h1>
            <p className="text-sm text-gray-500 mt-1.5">
              Times are shown in your time zone ({timezoneLabel}).
            </p>
          </header>

          {/* Week Navigator */}
          <RangeHeader
            startOfToday={startOfToday}
            onToday={handleToday}
            isTodaySelected={selectedDay === todayDayIndex}
          />

          {/* Day Selector */}
          <div className="mb-8 sm:mb-10">
            <DaySelector
              selectedDay={selectedDay}
              onSelect={setSelectedDay}
              animeCounts={animeCounts}
              todayDay={todayDayIndex}
              startOfToday={startOfToday}
              preferredTimezone={preferredTimezone}
            />
          </div>

          {/* Selected Day Header */}
          <div className="flex items-center justify-between gap-3 mb-5 sm:mb-6">
            <h2 className="text-lg font-bold text-white/90">
              {DAY_NAMES[selectedDay]}
              <span className="text-gray-500 font-normal ml-2">
                {/* Convert JS day index (0=Sun) to Monday-start offset (Mon=0, Tue=1, ..., Sun=6) */}
                {formatCalendarDate(
                  addDays(startOfToday, (selectedDay - todayDayIndex + 7) % 7),
                  { month: 'short', day: 'numeric' }
                )}
              </span>
            </h2>

            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-400">
                {selectedDayAnime.length} {selectedDayAnime.length === 1 ? 'episode' : 'episodes'}
              </div>
              {/* Members only: guests would just see a disabled control. */}
              {isAuthenticated && (
              <button
                onClick={handleToggleAdultContent}
                type="button"
                disabled={isUpdatingAdultContent}
                className={`flex items-center justify-center w-[40px] h-[40px] rounded-xl transition-colors ${
                  adultContentEnabled
                    ? 'bg-accent/20 text-accent'
                    : 'bg-dark-200 text-gray-400 hover:text-white'
                } ${!isAuthenticated || isUpdatingAdultContent ? 'opacity-60 cursor-not-allowed' : ''}`}
                aria-label={
                  adultContentEnabled ? 'Hide explicit hentai content' : 'Show explicit hentai content'
                }
                title={
                  !isAuthenticated
                    ? 'Log in to change explicit content visibility'
                    : adultContentEnabled
                      ? 'Explicit hentai: visible'
                      : 'Explicit hentai: hidden'
                }
              >
                {adultContentEnabled ? <Eye className="w-[18px] h-[18px]" /> : <EyeOff className="w-[18px] h-[18px]" />}
              </button>
              )}
            </div>
          </div>

          {/* Anime Grid */}
          {isLoading ? (
            <ScheduleGridSkeleton count={10} />
          ) : selectedDayAnime.length > 0 ? (
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6 anime-card-grid-gap">
              {selectedDayAnime.map((anime, index) => (
                <AnimeCard
                  key={anime.id}
                  anime={anime}
                  priority={index < 6}
                  index={index}
                  showAiringCountdown
                  metaText={formatAirTime(anime, preferredTimezone)}
                />
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
                There are no anime episodes airing on {DAY_NAMES[selectedDay]}.
                Try another day in the strip above.
              </p>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
