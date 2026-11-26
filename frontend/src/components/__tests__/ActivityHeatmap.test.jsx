import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityHeatmap from '../ActivityHeatmap';

vi.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

const daysAgo = (n) => {
    const date = new Date();
    date.setDate(date.getDate() - n);
    return date.toISOString().split('T')[0];
};
const activeDays = (count, perDay = 2) => Array.from({ length: count }, (_, i) => ({ date: daysAgo(i * 3 + 5), count: perDay }));

describe('ActivityHeatmap', () => {
    it('draws the year even when only a few days were logged', () => {
        render(<ActivityHeatmap activityData={[{ date: daysAgo(4), count: 58 }]} />);
        expect(screen.getByText('Last 12 months: 58 episodes logged on 1 day')).toBeInTheDocument();
        expect(screen.getByText('Less')).toBeInTheDocument();
    });

    it('sums the logged days in its sentence', () => {
        render(<ActivityHeatmap activityData={activeDays(14)} />);
        expect(screen.getByText('Last 12 months: 28 episodes logged on 14 days')).toBeInTheDocument();
    });

    it('is one sentence, no grid, when nothing was logged', () => {
        render(<ActivityHeatmap activityData={[]} />);
        expect(screen.getByText('Nothing logged in the last 12 months.')).toBeInTheDocument();
        expect(screen.queryByText('Less')).not.toBeInTheDocument();
    });
});
