import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityHeatmap, { MIN_ACTIVE_DAYS_FOR_GRID } from '../ActivityHeatmap';

vi.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

const daysAgo = (n) => {
    const date = new Date();
    date.setDate(date.getDate() - n);
    return date.toISOString().split('T')[0];
};
const activeDays = (count, perDay = 2) => Array.from({ length: count }, (_, i) => ({ date: daysAgo(i * 3 + 5), count: perDay }));

describe('ActivityHeatmap', () => {
    it('is one sentence about logged activity, no grid, for a sparse year', () => {
        render(<ActivityHeatmap activityData={[{ date: daysAgo(4), count: 58 }]} />);
        expect(screen.getByText('Last 12 months: 58 episodes logged on 1 day')).toBeInTheDocument();
        expect(screen.queryByText('Less')).not.toBeInTheDocument();
    });

    it('draws the year once there are enough active days', () => {
        render(<ActivityHeatmap activityData={activeDays(MIN_ACTIVE_DAYS_FOR_GRID)} />);
        expect(screen.getByText(`Last 12 months: ${MIN_ACTIVE_DAYS_FOR_GRID * 2} episodes logged on ${MIN_ACTIVE_DAYS_FOR_GRID} days`)).toBeInTheDocument();
        expect(screen.getByText('Less')).toBeInTheDocument();
    });
});
