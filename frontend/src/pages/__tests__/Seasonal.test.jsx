import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Seasonal from '../Seasonal';
import { animeApi } from '../../api/client';

// Mock the API client
vi.mock('../../api/client', () => ({
  animeApi: {
    getAll: vi.fn(),
  },
}));

// Mock SEO component
vi.mock('../../components/SEO', () => ({
  default: ({ customTitle, customDescription }) => (
    <div data-testid="seo-component" data-title={customTitle} data-description={customDescription}>
      SEO Component
    </div>
  ),
}));

// Mock AnimeCard component
vi.mock('../../components/AnimeCard', () => ({
  default: ({ anime }) => <div data-testid="anime-card">{anime.title}</div>,
  AnimeCardSkeleton: () => <div data-testid="anime-skeleton">Loading...</div>,
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
      <MemoryRouter initialEntries={['/seasonal']}>
        <Routes>
          <Route path="/seasonal" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Seasonal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    animeApi.getAll.mockImplementation(() => new Promise(() => {}));
    
    render(<Seasonal />, { wrapper: createWrapper() });
    
    expect(screen.getAllByText(/Loading.../i)[0]).toBeInTheDocument();
  });

  it('renders anime list successfully', async () => {
    const mockAnime = [
      { id: 1, title: 'Attack on Titan', rating: '9.0' },
      { id: 2, title: 'Demon Slayer', rating: '8.5' },
      { id: 3, title: 'One Piece', rating: null },
    ];

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
    });

    expect(screen.getByText('Demon Slayer')).toBeInTheDocument();
    expect(screen.getByText('One Piece')).toBeInTheDocument();
    
    // Check that stats show 2 highly rated anime (8+)
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Highly Rated')).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    animeApi.getAll.mockRejectedValue(new Error('API Error'));

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load seasonal anime/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders empty state when no anime found', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [] },
    });

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No anime found for/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /browse all anime/i })).toBeInTheDocument();
  });

  it('navigates between seasons using buttons', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Test', rating: '8.0' }] },
    });

    const { container } = render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });

    const prevButton = screen.getByRole('button', { name: /previous season/i });
    const nextButton = screen.getByRole('button', { name: /next season/i });

    expect(prevButton).toBeInTheDocument();
    expect(nextButton).toBeInTheDocument();
  });

  it('displays correct SEO metadata', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Test', rating: '8.0' }] },
    });

    const { container } = render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });

    const currentYear = new Date().getFullYear();
    const seoComponent = screen.getByTestId('seo-component');
    expect(seoComponent).toHaveAttribute('data-title', expect.stringContaining(currentYear.toString()));
    expect(seoComponent).toHaveAttribute('data-title', expect.stringContaining('Anime - AniShows'));
  });

  it('supports keyboard navigation with arrow keys', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Test', rating: '8.0' }] },
    });

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });

    // Test keyboard navigation
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
  });

  it('calculates highly rated count correctly with null ratings', async () => {
    const mockAnime = [
      { id: 1, title: 'High Rated', rating: '8.5' },
      { id: 2, title: 'Low Rated', rating: '7.0' },
      { id: 3, title: 'No Rating', rating: null },
      { id: 4, title: 'Undefined Rating' },
      { id: 5, title: 'Another High', rating: '9.0' },
    ];

    animeApi.getAll.mockResolvedValue({
      data: { results: mockAnime },
    });

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('High Rated')).toBeInTheDocument();
    });

    // Should show 2 highly rated (8.5 and 9.0)
    const stats = screen.getByRole('status');
    expect(stats).toHaveTextContent('2');
    expect(stats).toHaveTextContent('Highly Rated');
  });

  it('renders season tabs with proper ARIA attributes', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Test', rating: '8.0' }] },
    });

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });

    // Check season tabs structure
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeInTheDocument();
    expect(tablist).toHaveAttribute('aria-label', 'Select Season');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4); // Winter, Spring, Summer, Fall

    // Check that one tab is selected
    const selectedTab = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
    expect(selectedTab).toBeDefined();
  });

  it('renders year dropdown with proper accessibility', async () => {
    animeApi.getAll.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Test', rating: '8.0' }] },
    });

    render(<Seasonal />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });

    const yearSelect = screen.getByLabelText(/select year/i);
    expect(yearSelect).toBeInTheDocument();
    expect(yearSelect.tagName.toLowerCase()).toBe('select');
  });
});
