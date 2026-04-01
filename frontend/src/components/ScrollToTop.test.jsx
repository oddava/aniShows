import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';

function Harness() {
    const navigate = useNavigate();
    const location = useLocation();

    return (
        <>
            <ScrollToTop />
            <div data-testid="pathname">{location.pathname}</div>
            <button type="button" onClick={() => navigate('/anime/frieren/stats')}>
                Anime Tab
            </button>
            <button type="button" onClick={() => navigate('/anime/dandadan')}>
                Other Anime
            </button>
        </>
    );
}

describe('ScrollToTop', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        window.scrollTo = vi.fn();
    });

    it('does not reset scroll when switching tabs within the same anime detail page', async () => {
        render(
            <MemoryRouter initialEntries={['/anime/frieren']}>
                <Routes>
                    <Route path="*" element={<Harness />} />
                </Routes>
            </MemoryRouter>
        );

        expect(window.scrollTo).toHaveBeenCalledTimes(1);
        vi.mocked(window.scrollTo).mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Anime Tab' }));

        await waitFor(() => {
            expect(screen.getByTestId('pathname')).toHaveTextContent('/anime/frieren/stats');
        });

        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('still resets scroll when navigating to a different anime detail page', async () => {
        render(
            <MemoryRouter initialEntries={['/anime/frieren']}>
                <Routes>
                    <Route path="*" element={<Harness />} />
                </Routes>
            </MemoryRouter>
        );

        expect(window.scrollTo).toHaveBeenCalledTimes(1);
        vi.mocked(window.scrollTo).mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Other Anime' }));

        await waitFor(() => {
            expect(screen.getByTestId('pathname')).toHaveTextContent('/anime/dandadan');
        });

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });
});
