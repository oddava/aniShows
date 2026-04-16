import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

describe('Navbar keyboard shortcuts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('opens search without crashing when document.activeElement is null', () => {
        render(
            <MemoryRouter>
                <Navbar />
            </MemoryRouter>
        );

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
            render(
                <MemoryRouter>
                    <Navbar />
                </MemoryRouter>
            );

            await Promise.resolve();
        });

        expect(screen.queryByRole('link', { name: /forums/i })).not.toBeInTheDocument();
    });
});
