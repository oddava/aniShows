import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextEpisodePanel } from '../InformationBox';
import { syncStoredTimeZonePreference, clearStoredTimeZonePreference } from '../../utils/dateUtils';

describe('NextEpisodePanel', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-21T10:35:00Z'));
        syncStoredTimeZonePreference('UTC');
    });
    afterEach(() => {
        vi.useRealTimers();
        clearStoredTimeZonePreference();
    });

    it('shows the next airing in 24-hour time without a zone name', () => {
        render(<NextEpisodePanel anime={{ status: 'Airing', next_airing_episode: 4, next_airing_date: '2026-11-24T17:43:00Z' }} />);
        expect(screen.getByText('Next episode')).toBeInTheDocument();
        expect(screen.getByText('Tue, Nov 24 · 17:43')).toBeInTheDocument();
        expect(screen.queryByText(/GMT|PM|AM/)).not.toBeInTheDocument();
    });

    it('says the episode is out once its time has passed', () => {
        render(<NextEpisodePanel anime={{ status: 'Airing', next_airing_episode: 9, next_airing_date: '2026-11-21T10:04:00Z' }} />);
        expect(screen.getByText('Episode 9 is out')).toBeInTheDocument();
        expect(screen.getByText('Aired Sat, Nov 21 · 10:04')).toBeInTheDocument();
    });
});
