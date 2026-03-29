import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Bell,
} from 'lucide-react';
import { animeApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import { ScheduleGridSkeleton } from '../components/skeletons';
import { LoadingBar } from '../components/LoadingBar';
import SEO from '../components/SEO';
import ErrorBoundary from '../components/ErrorBoundary';

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// Helper to format date
const formatDate = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date);
};

// Day Selector Component
const DaySelector = ({ days, selectedDay, onSelect, animeCounts }) => {
  const scrollRef = useRef(null);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {days.map((day, index) => {
          const isSelected = selectedDay === index;
          const count = animeCounts[index] || 0;
          const isToday = new Date().getDay() === index;

          return (
            <button
              key={day}
              onClick={() => onSelect(index)}
              className={`
                flex-shrink-0 px-3 py-2 rounded-lg border transition-all duration-200 min-w-[60px]
                ${isSelected
                  ? 'bg-accent text-white border-accent  '
                  : 'bg-dark-100 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-white'
                }
                ${isToday && !isSelected ? 'border-accent/30' : ''}
              `}
            >
              <div className="text-[11px] font-medium uppercase tracking-wider">
                {DAY_SHORT[index]}
              </div>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <span className="text-base font-bold">{count}</span>
                {count > 0 && (
                  <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-accent'}`} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Week Navigator Component
const WeekNavigator = ({ currentWeek, onPrevWeek, onNextWeek, onToday }) => {
  const weekEnd = new Date(currentWeek);
  weekEnd.setDate(weekEnd.getDate() + 6);

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onPrevWeek}
          className="p-2 rounded-lg bg-dark-100 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 transition-all"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center">
          <div className="text-white font-semibold">
            <span>
              {formatDate(currentWeek)} - {formatDate(weekEnd)}
            </span>
          </div>
        </div>

        <button
          onClick={onNextWeek}
          className="p-2 rounded-lg bg-dark-100 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 transition-all"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <button
        onClick={onToday}
        className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-all text-sm font-medium"
      >
        Today
      </button>
    </div>
  );
};

// Main Schedule Page Component
export default function Schedule() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

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
      return dayIndex !== -1 ? dayIndex : new Date().getDay();
    }
    return new Date().getDay();
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

  // Fetch schedule data
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['schedule', currentWeek.toISOString(), isAuthenticated],
    queryFn: async () => {
      // For now, fetch airing anime and filter client-side
      // Later this should be a dedicated endpoint
      const response = await animeApi.getAll({
        status: 'Airing',
        sort: 'title', // Use 'title' to avoid filters that remove airing anime
        page_size: 200 // Increased to capture more airing anime
      });

      const animeList = response.data.results || [];

      // Group by day of week based on next_airing_date
      const days = Array(7).fill(null).map(() => []);

      // Get week boundaries in local time
      const weekStart = getWeekStart(currentWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      animeList.forEach(anime => {
        if (anime.next_airing_date) {
          // Parse the UTC date and convert to local timezone
          let airDate = new Date(anime.next_airing_date);

          // Check if date is valid before processing
          if (isNaN(airDate.getTime())) {
            return; // Skip anime with invalid dates
          }

          if (anime.status === 'Airing' && airDate < weekStart) {
            const msInWeek = 7 * 24 * 60 * 60 * 1000;
            const weeksToAdvance = Math.ceil((weekStart.getTime() - airDate.getTime()) / msInWeek);
            airDate = new Date(airDate.getTime() + (weeksToAdvance * msInWeek));
          }

          // Check if airing date is within current week
          // Compare using local time
          if (airDate >= weekStart && airDate < weekEnd) {
            // Get the day of week in local timezone (0 = Sunday, 1 = Monday, etc.)
            const dayIndex = airDate.getDay();
            days[dayIndex].push(anime);
          }
        }
      });

      // Sort each day by airing time
      days.forEach(dayAnime => {
        dayAnime.sort((a, b) => {
          const dateA = a.next_airing_date ? new Date(a.next_airing_date) : null;
          const dateB = b.next_airing_date ? new Date(b.next_airing_date) : null;

          // Handle null/invalid dates
          if (!dateA || isNaN(dateA.getTime())) return 1;
          if (!dateB || isNaN(dateB.getTime())) return -1;

          return dateA - dateB;
        });
      });

      return { days };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Calculate anime counts per day
  const animeCounts = useMemo(() => {
    if (!data) return Array(7).fill(0);
    return data.days.map(day => day.length);
  }, [data]);

  // Get anime for selected day
  const selectedDayAnime = useMemo(() => {
    if (!data) return [];
    return data.days[selectedDay] || [];
  }, [data, selectedDay]);

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
    setSelectedDay(today.getDay());
  };

  if (error) {
    return (
      <ErrorBoundary>
        <SEO page="schedule" />
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 mb-4">Failed to load schedule</p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Retry
            </button>
          </div>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Week Navigator */}
          <WeekNavigator
            currentWeek={currentWeek}
            onPrevWeek={handlePrevWeek}
            onNextWeek={handleNextWeek}
            onToday={handleToday}
          />

          {/* Day Selector */}
          <div className="mb-8">
            <DaySelector
              days={DAY_NAMES}
              selectedDay={selectedDay}
              onSelect={setSelectedDay}
              animeCounts={animeCounts}
            />
          </div>

          {/* Selected Day Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white/90">
              {DAY_NAMES[selectedDay]}
              <span className="text-gray-500 font-normal ml-2">
                {/* Convert JS day index (0=Sun) to Monday-start offset (Mon=0, Tue=1, ..., Sun=6) */}
                {formatDate(new Date(currentWeek.getTime() + ((selectedDay + 6) % 7) * 24 * 60 * 60 * 1000))}
              </span>
            </h2>

            <div className="text-sm text-gray-400">
              {selectedDayAnime.length} {selectedDayAnime.length === 1 ? 'episode' : 'episodes'}
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
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="w-20 h-20 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 text-gray-600" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                No episodes scheduled
              </h3>
              <p className="text-gray-400 max-w-md mx-auto">
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
