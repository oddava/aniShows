import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import QuickAdd from '../QuickAdd';

const open = (props) => {
    render(
        <QuickAdd
            variant="button"
            status="Watching"
            title="Airing Show"
            onSelect={vi.fn()}
            onScore={vi.fn()}
            {...props}
        />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change list status for Airing Show/i }));
};

describe('QuickAdd Completed hint', () => {
    it('promises only the aired episodes while a show is airing', () => {
        open({ watched: 3, total: 12, aired: 8 });
        expect(screen.getByText('marks the 8 aired episodes watched')).toBeInTheDocument();
        expect(screen.queryByText(/marks all 12/)).not.toBeInTheDocument();
    });

    it('promises every episode for a finished show', () => {
        open({ watched: 3, total: 12, aired: null });
        expect(screen.getByText('marks all 12 watched')).toBeInTheDocument();
    });

    it('says nothing when you are already caught up', () => {
        open({ watched: 8, total: 12, aired: 8 });
        expect(screen.queryByText(/marks/)).not.toBeInTheDocument();
    });
});
