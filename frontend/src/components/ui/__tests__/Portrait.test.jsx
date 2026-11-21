import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Portrait from '../Portrait';

describe('Portrait (D1)', () => {
    it('keeps a silhouette in the slot until the picture loads, then fades it in', () => {
        const { container } = render(<Portrait src="/a.jpg" alt="Frieren" className="h-16 w-16" />);
        const img = container.querySelector('img');
        expect(img).toHaveAttribute('data-loaded', 'false');
        expect(container.querySelector('svg')).toBeInTheDocument();

        fireEvent.load(img);
        expect(img).toHaveAttribute('data-loaded', 'true');
        expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('shows a named silhouette instead of a broken image when the picture fails or is missing', () => {
        const { container, rerender } = render(<Portrait src="/broken.jpg" alt="Himmel" />);
        fireEvent.error(container.querySelector('img'));
        expect(container.querySelector('img')).not.toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Himmel' })).toBeInTheDocument();

        rerender(<Portrait src="" alt="Heiter" />);
        expect(screen.getByRole('img', { name: 'Heiter' })).toBeInTheDocument();
    });
});
