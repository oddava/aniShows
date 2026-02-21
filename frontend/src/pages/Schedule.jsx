import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Tv,
  Bell,
  CheckCircle2
} from 'lucide-react';
import { animeApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getImageUrl } from '../utils/imageUtils';
import { ScheduleGridSkeleton } from '../components/skeletons';
import { Link } from 'react-router-dom';
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

// Helper to format time remaining
const getTimeRemaining = (dateString) => {
  if (!dateString) return 'Unknown';
  const target = new Date(dateString);
  // Check if date is valid
  if (isNaN(target.getTime())) return 'Unknown';
  
  const now = new Date();
  const diff = target - now;

  if (diff < 0) return 'Aired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

// Check if airing is within 24 hours
const isWithin24Hours = (dateString) => {
  if (!dateString) return false;
  const target = new Date(dateString);
  // Check if date is valid
  if (isNaN(target.getTime())) return false;
  
  const now = new Date();
  const diff = target - now;
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
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
                  ? 'bg-accent text-white border-accent shadow-lg shadow-accent/20'
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

// Schedule Card Component
const ScheduleCard = ({ anime, onUpdate }) => {
  const { isAuthenticated } = useAuth();
  const timeRemaining = getTimeRemaining(anime.next_airing_date);
  const isUrgent = isWithin24Hours(anime.next_airing_date);
  
  // Safely check if anime has aired
  const hasAired = (() => {
    if (!anime.next_airing_date) return false;
    const airDate = new Date(anime.next_airing_date);
    return !isNaN(airDate.getTime()) && airDate < new Date();
  })();

  return (
    <div
      className={`
        group relative bg-dark-100 rounded-xl border overflow-hidden transition-all duration-300
        ${isUrgent
          ? 'border-green-500/30 shadow-lg shadow-green-500/5'
          : 'border-gray-800 hover:border-gray-700'
        }
      `}
    >
      {/* Cover Image */}
      <Link to={`/anime/${anime.slug}`} className="block relative aspect-[2/3] overflow-hidden">
        <img
          src={getImageUrl(anime.cover_image)}
          alt={anime.title}
          className="w-full h-full object-cover"
        />

        {/* Episode Badge - Top Right */}
        <div className="absolute top-2 right-2">
          <div className={`
            px-2 py-1 rounded-md text-xs font-bold shadow-lg
            ${isUrgent
              ? 'bg-green-500 text-white'
              : 'bg-dark/90 backdrop-blur-sm text-white border border-white/30'
            }
          `}>
            EP {anime.next_airing_episode}
          </div>
        </div>

        {/* Airing Info Overlay - Bottom */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-8 pb-3 px-3">
          {hasAired ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500/20">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
              </div>
              <span className="text-sm font-semibold text-green-400">Aired</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className={`
                flex items-center justify-center w-5 h-5 rounded-full
                ${isUrgent ? 'bg-green-500/20' : 'bg-white/10'}
              `}>
                <Clock className={`w-3 h-3 ${isUrgent ? 'text-green-400' : 'text-white'}`} />
              </div>
              <span className={`
                text-sm font-semibold
                ${isUrgent ? 'text-green-400' : 'text-white'}
              `}>
                {timeRemaining}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Content */}
      <div className="p-3">
        <Link to={`/anime/${anime.slug}`}>
          <h3 className="text-xs font-semibold text-white line-clamp-2 group-hover:text-accent transition-colors mb-1.5 leading-relaxed">
            {anime.title}
          </h3>
        </Link>

        <div className="text-[11px] text-gray-400">
          {anime.anime_type} • {anime.episode_count} eps
        </div>

        {/* User Actions */}
        {isAuthenticated && anime.user_list_status && (
          <div className="mt-2.5 pt-2 border-t border-gray-800/50">
            <div className="flex items-center justify-between text-[11px]">
              <span className={`
                px-2 py-0.5 rounded font-medium
                ${anime.user_list_status.status === 'watching'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-gray-700/50 text-gray-400'
                }
              `}>
                {anime.user_list_status.status}
              </span>

              {anime.user_list_status.status === 'watching' && (
                <span className="text-gray-500 text-[11px]">
                  EP {anime.user_list_status.episodes_watched}/{anime.episode_count}
                </span>
              )}
            </div>
          </div>
        )}
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
          <div className="flex items-center gap-2 text-white font-semibold">
            <Calendar className="w-5 h-5 text-accent" />
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
  const queryClient = useQueryClient();

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
  const { data, isLoading, error } = useQuery({
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
          const airDate = new Date(anime.next_airing_date);

          // Check if date is valid before processing
          if (isNaN(airDate.getTime())) {
            return; // Skip anime with invalid dates
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

  // Handle list update
  const handleListUpdate = () => {
    // Refetch data
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
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
      <div className="min-h-screen pb-20">
        {/* Header */}
        <div className="bg-dark-100/50 border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center">
                    <Tv className="w-5 h-5 text-accent" />
                  </div>
                  <h1 className="text-3xl font-bold text-white">Anime Schedule</h1>
                </div>
                <p className="text-gray-400">
                  Track your weekly anime releases and never miss an episode
                </p>
              </div>
            </div>
          </div>
        </div>

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
            <h2 className="text-xl font-bold text-white">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {selectedDayAnime.map((anime) => (
                <ScheduleCard
                  key={anime.id}
                  anime={anime}
                  onUpdate={handleListUpdate}
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
