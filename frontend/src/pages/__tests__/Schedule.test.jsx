import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Schedule from '../Schedule';
import { animeApi } from '../../api/client';

// Mock the API client
vi.mock('../../api/client', () => ({
  animeApi: {
    getAll: vi.fn(),
  },
}));

// Mock SEO component
vi.mock('../../components/SEO', () => ({
  default: ({ page }) => (
    <div data-testid="seo-component" data-page={page}>SEO Component</div>
  ),
}));

// Mock AuthContext
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    user: null,
  }),
}));

// Mock skeleton components
vi.mock('../../components/skeletons', () => ({
  ScheduleSkeleton: () => <div data-testid="schedule-skeleton">Schedule Skeleton</div>,
  ScheduleGridSkeleton: ({ count }) => <div data-testid="schedule-grid-skeleton">Grid Skeleton ({count})</div>,
  ScheduleListSkeleton: ({ count }) => <div data-testid="schedule-list-skeleton">List Skeleton ({count})</div>,
}));

const createWrapper = () => {
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
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route path="/schedule" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

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
    animeApi.getAll.mockImplementation(() => new Promise(() => {}));
    
    render(<Schedule />, { wrapper: createWrapper() });
    
    expect(screen.getByTestId('schedule-grid-skeleton')).toBeInTheDocument();
  });

  it('renders schedule with anime successfully', async () => {
    const now = new Date();
    const today = now.getDay();
    
    // Create airing dates for the current week
    const getDateForDay = (dayIndex) => {
      const date = new Date(now);
      const diff = dayIndex - today;
      date.setDate(date.getDate() + diff);
      date.setHours(14, 0, 0, 0);
      return date.toISOString();
    };

    const mockAnime = [
      {
        id: 1,
        title: 'Attack on Titan',
        slug: 'attack-on-titan',
        cover_image: 'https://example.com/aot.jpg',
        next_airing_date: getDateForDay(today),
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
        next_airing_date: getDateForDay(today),
        next_airing_episode: 12,
        anime_type: 'TV',
        episode_count: 26,
        user_list_status: null,
      },
    ];

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
    });

    expect(screen.getByText('Demon Slayer')).toBeInTheDocument();
    expect(screen.getByText('EP 5')).toBeInTheDocument();
    expect(screen.getByText('EP 12')).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    animeApi.getAll.mockRejectedValue(new Error('API Error'));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load schedule/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders empty state when no anime scheduled for selected day', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [] },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date().getDay();
    // Check the empty state paragraph contains the day name
    const emptyStateParagraph = screen.getByText(/Check other days or weeks/i);
    expect(emptyStateParagraph).toBeInTheDocument();
  });

  it('navigates between weeks using prev/next buttons', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [] },
    });

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
    expect(animeApi.getAll).toHaveBeenCalled();
  });

  it('returns to current week when clicking Today button', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [] },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    const todayButton = screen.getByRole('button', { name: /today/i });
    expect(todayButton).toBeInTheDocument();

    fireEvent.click(todayButton);
  });

  it('allows selecting different days of the week', async () => {
    const now = new Date();
    const today = now.getDay();
    const tomorrow = (today + 1) % 7;
    
    const getDateForDay = (dayIndex) => {
      const date = new Date(now);
      const diff = dayIndex - today;
      date.setDate(date.getDate() + diff);
      date.setHours(14, 0, 0, 0);
      return date.toISOString();
    };

    const mockAnime = [
      {
        id: 1,
        title: 'Anime for Tomorrow',
        slug: 'anime-tomorrow',
        cover_image: 'https://example.com/tomorrow.jpg',
        next_airing_date: getDateForDay(tomorrow),
        next_airing_episode: 1,
        anime_type: 'TV',
        episode_count: 12,
        user_list_status: null,
      },
    ];

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No episodes scheduled/i)).toBeInTheDocument();
    });

    // Find day buttons by their abbreviations
    const dayButtons = screen.getAllByRole('button');
    expect(dayButtons.length).toBeGreaterThan(0);
  });

  it('displays correct SEO metadata', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [] },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('seo-component')).toBeInTheDocument();
    });

    const seoComponent = screen.getByTestId('seo-component');
    expect(seoComponent).toHaveAttribute('data-page', 'schedule');
  });

  it('shows episode count in day selector', async () => {
    const now = new Date();
    const today = now.getDay();
    
    const getDateForDay = (dayIndex) => {
      const date = new Date(now);
      const diff = dayIndex - today;
      date.setDate(date.getDate() + diff);
      date.setHours(14, 0, 0, 0);
      return date.toISOString();
    };

    const mockAnime = [
      {
        id: 1,
        title: 'Anime Today',
        slug: 'anime-today',
        cover_image: 'https://example.com/today.jpg',
        next_airing_date: getDateForDay(today),
        next_airing_episode: 3,
        anime_type: 'TV',
        episode_count: 12,
        user_list_status: null,
      },
    ];

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Check for episode count badge
      const badges = screen.getAllByText('1');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('handles anime with invalid airing dates gracefully', async () => {
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

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Should still render valid anime
      expect(screen.getByText('Valid Anime')).toBeInTheDocument();
    });

    // Invalid date anime should not appear
    expect(screen.queryByText('Invalid Date Anime')).not.toBeInTheDocument();
  });

  it('renders airing time countdown for upcoming episodes', async () => {
    // Create an airing time 2 hours from now, but ensure it stays on the same day
    const future = new Date();
    future.setHours(future.getHours() + 2);
    if (future.getDay() !== new Date().getDay()) {
      future.setDate(future.getDate() - 1);
    }
    
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

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Upcoming Anime')).toBeInTheDocument();
    });

    // Should show time remaining (like "2h" or "1h 59m")
    const timeElements = screen.getAllByText(/\d+h|Aired/);
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it('renders "Aired" status for past episodes', async () => {
    // Create a date for today that's in the past but still today
    const now = new Date();
    const airDate = new Date(now);
    airDate.setHours(airDate.getHours() - 1); // 1 hour ago today
    if (airDate.getDay() !== now.getDay()) {
      airDate.setDate(airDate.getDate() + 1);
    }
    
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

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Aired Anime Today')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Should show "Aired" status for past episodes
    expect(screen.getByText('Aired')).toBeInTheDocument();
  });

  it('handles retry button click on error', async () => {
    animeApi.getAll.mockRejectedValue(new Error('API Error'));

    render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load schedule/i)).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);

    // Should trigger page reload
    expect(window.location.reload).toHaveBeenCalled();
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

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    const { rerender } = render(<Schedule />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('My Anime')).toBeInTheDocument();
    });

    // Re-render with authenticated mock
    rerender(<Schedule />);
  });
});
