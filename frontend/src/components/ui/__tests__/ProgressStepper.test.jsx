import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ProgressStepper, { clampEpisodes, progressLabel } from '../ProgressStepper';

afterEach(() => {
    vi.useRealTimers();
});

describe('clampEpisodes', () => {
    it('keeps a count inside 0..total', () => {
        expect(clampEpisodes(13, 12)).toBe(12);
        expect(clampEpisodes(-2, 12)).toBe(0);
        expect(clampEpisodes(99, 0)).toBe(99);
        expect(clampEpisodes('7', null)).toBe(7);
    });
});

describe('progressLabel (D2)', () => {
    it('falls back to the aired count, then "?"', () => {
        expect(progressLabel(13, 24)).toEqual({ current: 13, rest: '/ 24' });
        expect(progressLabel(13, 0, 1180)).toEqual({ current: 13, rest: '/ 1180 aired' });
        expect(progressLabel(13, 0, null)).toEqual({ current: 13, rest: '/ ?' });
    });
});

describe('ProgressStepper (T3)', () => {
    it('shows an Undo at once, even while the +1 is still being written', async () => {
        vi.useFakeTimers();
        let resolveWrite;
        const onCommit = vi.fn(() => new Promise((resolve) => { resolveWrite = resolve; }));
        const { rerender } = render(<ProgressStepper value={3} total={12} onCommit={onCommit} title="Blue Box" />);

        fireEvent.click(screen.getByRole('button', { name: 'One episode more of Blue Box' }));
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(onCommit).toHaveBeenCalledWith(4, 3);
        // The entry moves to 4 (optimistic), then Undo puts it back to 3
        // before the write has answered.
        rerender(<ProgressStepper value={4} total={12} onCommit={onCommit} title="Blue Box" />);
        rerender(<ProgressStepper value={3} total={12} onCommit={onCommit} title="Blue Box" />);
        expect(screen.getByRole('group')).toHaveTextContent('3 / 12');
        await act(async () => { resolveWrite(null); });
        expect(screen.getByRole('group')).toHaveTextContent('3 / 12');
    });

    it('batches quick taps into one write with the value before the burst', async () => {
        vi.useFakeTimers();
        const onCommit = vi.fn().mockResolvedValue(null);
        render(<ProgressStepper value={12} total={24} onCommit={onCommit} title="Frieren" />);

        const more = screen.getByRole('button', { name: 'One episode more of Frieren' });
        fireEvent.click(more);
        fireEvent.click(more);
        fireEvent.click(more);
        expect(screen.getByRole('group')).toHaveTextContent('15 / 24');
        expect(onCommit).not.toHaveBeenCalled();

        await act(async () => { vi.advanceTimersByTime(500); });

        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(15, 12);
    });

    it('cannot go past the episode count or below zero', async () => {
        vi.useFakeTimers();
        const onCommit = vi.fn();
        const { rerender } = render(<ProgressStepper value={24} total={24} onCommit={onCommit} />);

        expect(screen.getByRole('button', { name: 'One episode more' })).toBeDisabled();

        rerender(<ProgressStepper value={0} total={24} onCommit={onCommit} />);
        expect(screen.getByRole('button', { name: 'One episode less' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'One episode less' }));
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('flushes acknowledged taps when the page goes away mid-burst', () => {
        vi.useFakeTimers();
        const onCommit = vi.fn();
        const { unmount } = render(<ProgressStepper value={12} total={0} onCommit={onCommit} title="One Piece" />);

        fireEvent.click(screen.getByRole('button', { name: 'One episode more of One Piece' }));
        unmount();

        expect(onCommit).toHaveBeenCalledWith(13, 12);
    });

    it('a net-zero burst writes nothing', async () => {
        vi.useFakeTimers();
        const onCommit = vi.fn();
        render(<ProgressStepper value={5} total={0} onCommit={onCommit} />);

        fireEvent.click(screen.getByRole('button', { name: 'One episode more' }));
        fireEvent.click(screen.getByRole('button', { name: 'One episode less' }));
        await act(async () => { vi.advanceTimersByTime(500); });

        expect(onCommit).not.toHaveBeenCalled();
        expect(screen.getByRole('group')).toHaveTextContent('5 / ?');
    });
});
