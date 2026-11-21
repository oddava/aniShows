import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScorePicker from '../ScorePicker';

describe('ScorePicker (T4)', () => {
    it('is a 1–10 radio group: one tap picks a score', () => {
        const onChange = vi.fn();
        render(<ScorePicker value={0} onChange={onChange} />);

        expect(screen.getAllByRole('radio')).toHaveLength(10);
        fireEvent.click(screen.getByRole('radio', { name: '9 out of 10' }));
        expect(onChange).toHaveBeenCalledWith(9);
    });

    it('marks the current score and moves with the arrow keys', () => {
        const onChange = vi.fn();
        render(<ScorePicker value={7} onChange={onChange} />);

        const seven = screen.getByRole('radio', { name: '7 out of 10' });
        expect(seven).toHaveAttribute('aria-checked', 'true');
        expect(seven).toHaveAttribute('tabindex', '0');

        fireEvent.keyDown(seven, { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith(8);
    });

    it('clears back to unscored', () => {
        const onChange = vi.fn();
        render(<ScorePicker value={6} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear score' }));
        expect(onChange).toHaveBeenCalledWith(0);
    });
});
