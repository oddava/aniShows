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

describe('QuickAdd status menu', () => {
    it('lists the statuses without any progress hint under Completed', () => {
        open({ watched: 3, total: 12, aired: 8 });
        expect(screen.getByRole('menuitemradio', { name: 'Completed' })).toBeInTheDocument();
        expect(screen.queryByText(/marks/)).not.toBeInTheDocument();
    });
});
