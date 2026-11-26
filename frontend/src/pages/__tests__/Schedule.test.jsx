import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Schedule from '../Schedule';
import { animeApi } from '../../api/client';

vi.mock('../../components/AnimeCard', () => ({
  default: ({ anime, showAiringCountdown, metaText }) => (
    <div data-testid="anime-card">
      <span>{anime.title}</span>
      {showAiringCountdown && anime.next_airing_episode ? (
        <span>{`EP ${anime.next_airing_episode}`}</span>
      ) : null}
      {metaText ? <span>{metaText}</span> : null}
    </div>
  ),
}));

// Mock the API client
vi.mock('../../api/client', () => ({
  animeApi: {
    getSchedule: vi.fn(),
  },
  authApi: {
    updateProfile: vi.fn(),
  },
}));

// Mock SEO component
vi.mock('../../components/SEO', () => ({
  default: ({ page }) => (
    <div data-testid="seo-component" data-page={page}>SEO Component</div>
  ),
}));

// Mock AuthContext (the user is swappable per test, e.g. for a time zone)
const mockAuth = vi.hoisted(() => ({ user: null, isAuthenticated: false }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockAuth.isAuthenticated,
    user: mockAuth.user,
    refreshProfile: vi.fn(),
  }),
}));

// Mock skeleton components
vi.mock('../../components/skeletons', () => ({
  ScheduleSkeleton: () => <div data-testid="schedule-skeleton">Schedule Skeleton</div>,
  ScheduleGridSkeleton: ({ count }) => <div data-testid="schedule-grid-skeleton">Grid Skeleton ({count})</div>,
  ScheduleListSkeleton: ({ count }) => <div data-testid="schedule-list-skeleton">List Skeleton ({count})</div>,
}));

const createWrapper = (initialEntry = '/schedule') => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  });

  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/schedule" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const buildScheduleResponse = (overrides = {}) => ({
  data: {
    days: {
      sunday: [],
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      ...overrides,
    },
  },
});

describe('Schedule Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: vi.fn(), pathname: '/schedule' },
    });
  });

  it('renders loading state initially', () => {
    animeApi.getSchedule.mockImplementation(() => new Promise(() => {}));
    
    render(<Schedule />, { wrapper: createWrapper() });
    
    expect(screen.getByTestId('schedule-grid-skeleton')).toBeInTheDocument();
  });

  it('renders schedule with anime successfully', async () => {
    const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    const firstAiringDate = new Date();
    firstAiringDate.setHours(12, 0, 0, 0);
    const secondAiringDate = new Date(firstAiringDate);
    secondAiringDate.setHours(13, 0, 0, 0);

    const mockAnime = [
      {
        id: 1,
        title: 'Attack on Titan',
        slug: 'attack-on-titan',
        cover_image: 'https://example.com/aot.jpg',
        next_airing_date: firstAiringDate.toISOString(),
        next_airing_episode: 5,
        anime_type: 'TV',
        episode_count: 24,
        user_list_status: null,
      },
      {
        id: 2,
        title: 'Demon Slayer',
        slug: 'demon-slayer',
        cover_image: 'https://example.com/ds.jpg',
        next_airing_date: secondAiringDate.toISOString(),
        next_airing_episode: 12,
        anime_type: 'TV',
        episode_count: 26,
        user_list_status: null,
      },
    ];

    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [todayKey]: mockAnime }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
    });

    expect(screen.getByText('Demon Slayer')).toBeInTheDocument();
    expect(screen.getAllByTestId('anime-card')).toHaveLength(2);
    expect(screen.getByText('EP 5')).toBeInTheDocument();
    expect(screen.getByText('EP 12')).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    animeApi.getSchedule.mockRejectedValue(new Error('API Error'));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load schedule/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders empty state when no anime scheduled for selected day', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse());

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    const emptyStateParagraph = screen.getByText(/Try another day/i);
    expect(emptyStateParagraph).toBeInTheDocument();
  });

  it('navigates between weeks using prev/next buttons', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse());

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    // Get all buttons and find prev/next by their icons/position
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(3); // At least prev, next, today, and day selectors

    // Click next week button (should be second button after prev)
    const nextButton = buttons[1];
    fireEvent.click(nextButton);
    
    // Click previous week button
    const prevButton = buttons[0];
    fireEvent.click(prevButton);
    
    // API should have been called multiple times
    expect(animeApi.getSchedule).toHaveBeenCalledTimes(1);
  });

  it('offers a way back to today only when another day is selected', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse());

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Back to today' })).not.toBeInTheDocument();

    const dayButtons = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed') && /episode/.test(button.getAttribute('aria-label') || button.textContent));
    const otherDay = dayButtons.find((button) => button.getAttribute('aria-pressed') === 'false');
    fireEvent.click(otherDay);

    const backButton = screen.getByRole('button', { name: 'Back to today' });
    fireEvent.click(backButton);
    expect(screen.queryByRole('button', { name: 'Back to today' })).not.toBeInTheDocument();
  });

  it('allows selecting different days of the week', async () => {
    const tomorrowKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][(new Date().getDay() + 1) % 7];
    const mockAnime = [
      {
        id: 1,
        title: 'Anime for Tomorrow',
        slug: 'anime-tomorrow',
        cover_image: 'https://example.com/tomorrow.jpg',
        next_airing_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        next_airing_episode: 1,
        anime_type: 'TV',
        episode_count: 12,
        user_list_status: null,
      },
    ];

    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [tomorrowKey]: mockAnime }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    // Find day buttons by their abbreviations
    const dayButtons = screen.getAllByRole('button');
    expect(dayButtons.length).toBeGreaterThan(0);
  });

  it('displays correct SEO metadata', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse());

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('seo-component')).toBeInTheDocument();
    });

    const seoComponent = screen.getByTestId('seo-component');
    expect(seoComponent).toHaveAttribute('data-page', 'schedule');
  });

  it('shows episode count in day selector', async () => {
    const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    const mockAnime = [
      {
        id: 1,
        title: 'Anime Today',
        slug: 'anime-today',
        cover_image: 'https://example.com/today.jpg',
        next_airing_date: new Date().toISOString(),
        next_airing_episode: 3,
        anime_type: 'TV',
        episode_count: 12,
        user_list_status: null,
      },
    ];

    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [todayKey]: mockAnime }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Check for episode count badge
      const badges = screen.getAllByText('1');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('handles anime with invalid airing dates gracefully', async () => {
    const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    const mockAnime = [
      {
        id: 1,
        title: 'Invalid Date Anime',
        slug: 'invalid-date',
        cover_image: 'https://example.com/invalid.jpg',
        next_airing_date: 'invalid-date-string',
        next_airing_episode: 1,
        anime_type: 'TV',
        episode_count: 12,
        user_list_status: null,
      },
      {
        id: 2,
        title: 'Valid Anime',
        slug: 'valid-anime',
        cover_image: 'https://example.com/valid.jpg',
        next_airing_date: new Date().toISOString(),
        next_airing_episode: 5,
        anime_type: 'TV',
        episode_count: 24,
        user_list_status: null,
      },
    ];

    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [todayKey]: mockAnime }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Valid Anime')).toBeInTheDocument();
    });

    expect(screen.getByText('Invalid Date Anime')).toBeInTheDocument();
  });

  it('renders airing time countdown for upcoming episodes', async () => {
    // Create an airing time 2 hours from now, but ensure it stays on the same day
    const future = new Date();
    future.setHours(future.getHours() + 2);
    if (future.getDay() !== new Date().getDay()) {
      future.setDate(future.getDate() - 1);
    }
    const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    
    const mockAnime = [
      {
        id: 1,
        title: 'Upcoming Anime',
        slug: 'upcoming',
        cover_image: 'https://example.com/upcoming.jpg',
        next_airing_date: future.toISOString(),
        next_airing_episode: 5,
        anime_type: 'TV',
        episode_count: 24,
        user_list_status: null,
      },
    ];

    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [todayKey]: mockAnime }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Upcoming Anime')).toBeInTheDocument();
    });
  });

  it('renders "Aired" status for past episodes', async () => {
    // Create a date for today that's in the past but still today
    const now = new Date();
    const airDate = new Date(now);
    airDate.setHours(airDate.getHours() - 1); // 1 hour ago today
    if (airDate.getDay() !== now.getDay()) {
      airDate.setDate(airDate.getDate() + 1);
    }
    const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    
    const mockAnime = [
      {
        id: 1,
        title: 'Aired Anime Today',
        slug: 'aired-today',
        cover_image: 'https://example.com/aired.jpg',
        next_airing_date: airDate.toISOString(),
        next_airing_episode: 5,
        anime_type: 'TV',
        episode_count: 24,
        user_list_status: null,
      },
    ];

    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [todayKey]: mockAnime }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Aired Anime Today')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('handles retry button click on error', async () => {
    animeApi.getSchedule.mockRejectedValue(new Error('API Error'));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load schedule/i)).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);

    // Retries in place (refetch), without reloading the page
    await waitFor(() => {
      expect(animeApi.getSchedule).toHaveBeenCalledTimes(2);
    });
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

describe('Schedule Component - Authenticated User', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock authenticated user
    vi.doMock('../../context/AuthContext', () => ({
      useAuth: () => ({
        isAuthenticated: true,
        user: { id: 1, username: 'testuser' },
      }),
    }));
  });

  it('displays user watch status when authenticated', async () => {
    const now = new Date();
    
    const mockAnime = [
      {
        id: 1,
        title: 'My Anime',
        slug: 'my-anime',
        cover_image: 'https://example.com/my.jpg',
        next_airing_date: now.toISOString(),
        next_airing_episode: 5,
        anime_type: 'TV',
        episode_count: 24,
        user_list_status: {
          status: 'watching',
          episodes_watched: 4,
        },
      },
    ];

    const todayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({ [todayKey]: mockAnime }));

    const { rerender } = render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('My Anime')).toBeInTheDocument();
    });

    // Re-render with authenticated mock
    rerender(<Schedule />);
  });
});

describe('Schedule Component - preferred time zone far from the browser', () => {
  afterEach(() => {
    mockAuth.user = null;
    vi.useRealTimers();
  });

  it('labels the strip and the day heading with the same calendar date (UTC+14)', async () => {
    // 12:00 UTC on Mon Nov 16 is already 02:00 on Tue Nov 17 in Kiritimati.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0)));
    mockAuth.user = { preferred_timezone: 'Pacific/Kiritimati' };
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse());

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    const selected = screen.getByRole('button', { pressed: true });
    expect(selected).toHaveAccessibleName(/^\S+ 17 .*\(Tuesday, /);
    const heading = screen.getByRole('heading', { level: 2, name: /Tuesday/ });
    expect(heading).toHaveTextContent('17 Nov');
  });
});

describe('Schedule Component - calendar dates and My list', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  // Monday 2026-11-16 12:00 UTC.
  const NOW = Date.UTC(2026, 10, 16, 12, 0);
  const show = (id, title, nextAiringDate, extra = {}) => ({
    id,
    title,
    slug: `show-${id}`,
    next_airing_date: nextAiringDate == null ? null : new Date(nextAiringDate).toISOString(),
    next_airing_episode: 3,
    user_list_status: null,
    ...extra,
  });
  // Names start with the visible text ("Today 16 1 ep", "Wed 18 1 ep"), then
  // spell it out: "(Monday, 1 episode)".
  const dayButton = (label) => {
    const [weekday, date] = label.split(' ');
    return screen.getByRole('button', { name: new RegExp(`^\\S+ ${date} .*\\(${weekday}, `) });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    mockAuth.user = { preferred_timezone: 'UTC' };
  });

  afterEach(() => {
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
    vi.useRealTimers();
  });

  it('puts each show under its calendar date and counts the ones airing later', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({
      monday: [
        show(1, 'Aired This Morning', NOW - 3 * HOUR),
        show(2, 'Ten Days Out', NOW + 10 * DAY),
        show(3, 'Stale Last Week', NOW - 7 * DAY),
      ],
      wednesday: [show(4, 'Two Days Out', NOW + 2 * DAY)],
      thursday: [show(5, 'No Date Yet', null, { broadcast_day: 'Thursday' })],
    }));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Aired This Morning')).toBeInTheDocument();
    });
    expect(screen.getByText(/^09:00/)).toBeInTheDocument();
    expect(screen.queryByText('Stale Last Week')).not.toBeInTheDocument();
    expect(screen.getByText('1 more airs later')).toBeInTheDocument();

    // Label and count of each column come from the same date.
    expect(dayButton('Monday 16')).toHaveAccessibleName(/^\S+ 16 \d+ ep \(Monday, 1 episode\)$/);
    expect(dayButton('Wednesday 18')).toHaveAccessibleName(/^\S+ 18 \d+ ep \(Wednesday, 1 episode\)$/);
    expect(dayButton('Thursday 19')).toHaveAccessibleName(/^\S+ 19 \d+ ep \(Thursday, 1 episode\)$/);
    expect(dayButton('Monday 16')).not.toHaveAccessibleName(/2 episodes/);

    fireEvent.click(dayButton('Wednesday 18'));
    expect(screen.getByText('Two Days Out')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Wednesday/ })).toHaveTextContent('18 Nov');

    fireEvent.click(dayButton('Thursday 19'));
    expect(screen.getByText('No Date Yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Time not announced/ })).toBeInTheDocument();
    expect(screen.queryByText('Ten Days Out')).not.toBeInTheDocument();
  });

  it('keeps weekday names in ?day= links', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({
      wednesday: [show(4, 'Two Days Out', NOW + 2 * DAY)],
    }));

    render(<Schedule />, { wrapper: createWrapper('/schedule?day=wednesday') });

    await waitFor(() => {
      expect(screen.getByText('Two Days Out')).toBeInTheDocument();
    });
    expect(dayButton('Wednesday 18')).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides the My list toggle from guests', async () => {
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse());

    render(<Schedule />, { wrapper: createWrapper('/schedule?mine=1') });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'My list' })).not.toBeInTheDocument();
  });

  it('filters to the member\'s list with ?mine=1 and the counts follow', async () => {
    mockAuth.isAuthenticated = true;
    animeApi.getSchedule.mockResolvedValue(buildScheduleResponse({
      monday: [
        show(1, 'Watching Show', NOW + HOUR, { user_list_status: { status: 'Watching' } }),
        show(2, 'Planned Show', NOW + 2 * HOUR, { user_list_status: { status: 'Plan to Watch' } }),
        show(3, 'Completed Show', NOW + 3 * HOUR, { user_list_status: { status: 'Completed' } }),
        show(4, 'Dropped Show', NOW + 4 * HOUR, { user_list_status: { status: 'Dropped' } }),
        show(5, 'Not Listed', NOW + 5 * HOUR),
      ],
    }));

    render(<Schedule />, { wrapper: createWrapper('/schedule?mine=1') });

    await waitFor(() => {
      expect(screen.getAllByText('Watching Show').length).toBeGreaterThan(0);
    });
    const toggle = screen.getByRole('button', { name: 'My list' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Planned Show').length).toBeGreaterThan(0);
    expect(screen.getByRole('complementary', { name: 'Your week' })).toHaveTextContent('Watching Show');
    expect(screen.queryByText('Completed Show')).not.toBeInTheDocument();
    expect(screen.queryByText('Dropped Show')).not.toBeInTheDocument();
    expect(screen.queryByText('Not Listed')).not.toBeInTheDocument();
    expect(dayButton('Monday 16')).toHaveAccessibleName(/^\S+ 16 \d+ ep \(Monday, 2 episodes\)$/);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('anime-card')).toHaveLength(5);
    expect(dayButton('Monday 16')).toHaveAccessibleName(/^\S+ 16 \d+ ep \(Monday, 5 episodes\)$/);
  });
});
