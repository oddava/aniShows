import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OverviewStats from './OverviewStats';

const zero = { watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 };

describe('OverviewStats', () => {
    it('renders nothing without any counts', () => {
        const { container } = render(<OverviewStats anime={{ status_distribution: zero, site_status_distribution: zero }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("prefers AniList's status counts and shows the score bars", () => {
        render(<OverviewStats anime={{
            status_distribution: { ...zero, watching: 300, completed: 100 },
            site_status_distribution: { ...zero, watching: 2 },
            site_score_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 2, 9: 1, 10: 0 },
        }} />);
        // AniList's counts win: 300 of 400 watching.
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('Score 8: 2 people')).toBeInTheDocument();
    });

    it("falls back to AniShows' own lists when AniList has none", () => {
        render(<OverviewStats anime={{ status_distribution: zero, site_status_distribution: { ...zero, dropped: 1 } }} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
        expect(screen.queryByText('Score distribution')).not.toBeInTheDocument();
    });
});
