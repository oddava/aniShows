import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Spoiler from './Spoiler';

const renderSpoiler = (props = {}) =>
    render(
        <p>
            before <Spoiler {...props}>the hidden twist</Spoiler> after
        </p>,
    );

describe('Spoiler', () => {
    it('is a collapsed button with an accessible name and no hidden text before reveal', () => {
        const { container } = renderSpoiler();
        const button = screen.getByRole('button', { name: 'Spoiler, activate to reveal' });
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('the hidden twist')).toBeNull();
        expect(container.textContent).not.toContain('the hidden twist');
        // The visible placeholder is decorative; the label carries the meaning.
        expect(screen.getByText('Spoiler')).toHaveAttribute('aria-hidden', 'true');
    });

    it('is reachable with Tab and toggles with Enter and Space', async () => {
        const user = userEvent.setup();
        renderSpoiler();
        await user.tab();
        const button = screen.getByRole('button');
        expect(button).toHaveFocus();

        await user.keyboard('{Enter}');
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('the hidden twist')).toBeInTheDocument();
        expect(button).not.toHaveAttribute('aria-label');

        await user.keyboard(' ');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('the hidden twist')).toBeNull();

        await user.keyboard(' ');
        expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles on click without triggering a clickable ancestor', async () => {
        const user = userEvent.setup();
        const onCardClick = vi.fn();
        render(
            <div onClick={onCardClick}>
                <Spoiler>secret</Spoiler>
            </div>,
        );
        await user.click(screen.getByRole('button'));
        expect(screen.getByText('secret')).toBeInTheDocument();
        expect(onCardClick).not.toHaveBeenCalled();
    });

    it('respects reduced motion and keeps the minimal inline style', () => {
        renderSpoiler({ className: 'extra' });
        const button = screen.getByRole('button');
        expect(button.className).toContain('motion-reduce:transition-none');
        expect(button.className).toContain('inline');
        expect(button.className).toContain('extra');
    });
});
