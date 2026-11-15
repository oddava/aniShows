import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
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
  formatDate,
  getCurrentWeekdayIndex,
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
    const zone = preferredTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? zone.replace(/_/g, ' ') : 'local time';
  } catch {
    return 'local time';
  }
};

// Helper to get start of week (Monday) - normalizes to midnight UTC
const getWeekStart = (date) => {
  const d = new Date(date);
  // Reset to midnight local time
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
};

// Day Selector Component
// Monday-first, matching the week range above it. Seven equal columns, so the
// whole week is visible on a phone without sideways scrolling.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DaySelector = ({ selectedDay, onSelect, animeCounts, todayDay, currentWeek, preferredTimezone }) => {
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2" role="group" aria-label="Day of the week">
      {WEEK_ORDER.map((index, position) => {
        const isSelected = selectedDay === index;
        const count = animeCounts[index] || 0;
        const isToday = todayDay === index;
        const date = new Date(currentWeek.getTime() + position * 24 * 60 * 60 * 1000);
        const dayOfMonth = formatDate(date, { day: 'numeric' }, preferredTimezone);

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
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// Week Navigator Component
const WeekNavigator = ({ currentWeek, onPrevWeek, onNextWeek, onToday, preferredTimezone }) => {
  const weekEnd = new Date(currentWeek);
  weekEnd.setDate(weekEnd.getDate() + 6);

  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onPrevWeek}
          aria-label="Previous week"
          className="ui-icon-button h-9 w-9"
        >
          <ChevronLeft aria-hidden="true" className="w-5 h-5" />
        </button>

        <div className="text-center min-w-[8.5rem]">
          <div className="text-white font-semibold tabular" aria-live="polite">
            <span>
              {formatDate(currentWeek, { month: 'short', day: 'numeric' }, preferredTimezone)}
              {' - '}
              {formatDate(weekEnd, { month: 'short', day: 'numeric' }, preferredTimezone)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNextWeek}
          aria-label="Next week"
          className="ui-icon-button h-9 w-9"
        >
          <ChevronRight aria-hidden="true" className="w-5 h-5" />
        </button>
      </div>

      <button
        type="button"
        onClick={onToday}
        className="ui-pill-button h-9 py-0"
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

  // Get initial week from URL or use current week
  const [currentWeek, setCurrentWeek] = useState(() => {
    const weekParam = searchParams.get('week');
    let date;
    if (weekParam) {
      // Trim any whitespace and parse the date; fallback to today if invalid
      const trimmedParam = weekParam.trim();
      const parsed = new Date(trimmedParam + 'T00:00:00');
      date = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      date = new Date();
    }
    return getWeekStart(date);
  });

  // Get initial day from URL or use today
  const [selectedDay, setSelectedDay] = useState(() => {
    const dayParam = searchParams.get('day');
    if (dayParam) {
      const dayIndex = DAY_NAMES.findIndex(d => d.toLowerCase() === dayParam.toLowerCase());
      return dayIndex !== -1 ? dayIndex : getCurrentWeekdayIndex(preferredTimezone);
    }
    return getCurrentWeekdayIndex(preferredTimezone);
  });



  // Update URL when week or day changes
  useEffect(() => {
    // Safety check: if currentWeek is invalid, reset to today
    if (!currentWeek || isNaN(currentWeek.getTime())) {
      setCurrentWeek(getWeekStart(new Date()));
      return;
    }
    const params = new URLSearchParams();
    // Use local date string (YYYY-MM-DD) to avoid UTC shift issues
    const year = currentWeek.getFullYear();
    const month = String(currentWeek.getMonth() + 1).padStart(2, '0');
    const day = String(currentWeek.getDate()).padStart(2, '0');
    params.set('week', `${year}-${month}-${day}`);
    params.set('day', DAY_NAMES[selectedDay].toLowerCase());
    setSearchParams(params, { replace: true });
  }, [currentWeek, selectedDay, setSearchParams]);

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

  // Week navigation handlers
  const handlePrevWeek = () => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(newWeek.getDate() - 7);
    setCurrentWeek(newWeek);
  };

  const handleNextWeek = () => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(newWeek.getDate() + 7);
    setCurrentWeek(newWeek);
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentWeek(getWeekStart(today));
    setSelectedDay(getCurrentWeekdayIndex(preferredTimezone));
  };

  if (error) {
    return (
      <ErrorBoundary>
        <SEO page="schedule" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <header className="mb-6">
            <h1 className="page-title">Airing Schedule</h1>
            <p className="text-sm text-gray-500 mt-1.5">
              Times are shown in your time zone ({timezoneLabel}).
            </p>
          </header>

          {/* Week Navigator */}
          <WeekNavigator
            currentWeek={currentWeek}
            onPrevWeek={handlePrevWeek}
            onNextWeek={handleNextWeek}
            onToday={handleToday}
            preferredTimezone={preferredTimezone}
          />

          {/* Day Selector */}
          <div className="mb-8 sm:mb-10">
            <DaySelector
              selectedDay={selectedDay}
              onSelect={setSelectedDay}
              animeCounts={animeCounts}
              todayDay={todayDayIndex}
              currentWeek={currentWeek}
              preferredTimezone={preferredTimezone}
            />
          </div>

          {/* Selected Day Header */}
          <div className="flex items-center justify-between gap-3 mb-5 sm:mb-6">
            <h2 className="text-lg font-bold text-white/90">
              {DAY_NAMES[selectedDay]}
              <span className="text-gray-500 font-normal ml-2">
                {/* Convert JS day index (0=Sun) to Monday-start offset (Mon=0, Tue=1, ..., Sun=6) */}
                {formatDate(
                  new Date(currentWeek.getTime() + ((selectedDay + 6) % 7) * 24 * 60 * 60 * 1000),
                  { month: 'short', day: 'numeric' },
                  preferredTimezone
                )}
              </span>
            </h2>

            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-400">
                {selectedDayAnime.length} {selectedDayAnime.length === 1 ? 'episode' : 'episodes'}
              </div>
              <button
                onClick={handleToggleAdultContent}
                disabled={!isAuthenticated || isUpdatingAdultContent}
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
            </div>
          </div>

          {/* Anime Grid */}
          {isLoading ? (
            <ScheduleGridSkeleton count={10} />
          ) : selectedDayAnime.length > 0 ? (
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 anime-card-grid-gap">
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
                Check other days or weeks to see upcoming releases.
              </p>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
