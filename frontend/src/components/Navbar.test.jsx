import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Navbar from './Navbar';

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({
        user: null,
        logout: vi.fn(),
        isAuthenticated: false,
        loading: false,
    }),
}));

vi.mock('../api/client', () => ({
    animeApi: {
        getAll: vi.fn(() => new Promise(() => {})),
    },
    notificationApi: {
        getUnreadCount: vi.fn(() => new Promise(() => {})),
    },
}));

vi.mock('../hooks/useWebSocket', () => ({
    useWebSocket: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
    default: {
        error: vi.fn(),
    },
    isRequestAbortError: vi.fn(() => false),
}));

vi.mock('./Logo', () => ({
    default: () => <span>AniShows</span>,
}));

const renderNavbar = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
            <Navbar />
        </MemoryRouter>
    </QueryClientProvider>
);

describe('Navbar keyboard shortcuts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        act(() => {
            vi.runOnlyPendingTimers();
        });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('opens search without crashing when document.activeElement is null', () => {
        renderNavbar();

        const input = screen.getByPlaceholderText('Search anime...');
        const activeElementSpy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);

        expect(() => {
            act(() => {
                fireEvent.keyDown(document, { key: '/' });
            });
        }).not.toThrow();

        activeElementSpy.mockRestore();
        act(() => {
            vi.advanceTimersByTime(60);
        });

        expect(input).toHaveFocus();
    });

    it('does not render a forums link in the header', async () => {
        await act(async () => {
            renderNavbar();

            await Promise.resolve();
        });

        expect(screen.queryByRole('link', { name: /forums/i })).not.toBeInTheDocument();
    });
});
