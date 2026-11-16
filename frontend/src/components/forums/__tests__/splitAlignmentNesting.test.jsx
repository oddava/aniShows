import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import MarkdownRenderer from '../../common/MarkdownRenderer';
import { exceedsContainerLimits } from '../remarkCommunity';
import { SYNC_MAX_LENGTH } from '../useCommunityTree';

/*
 * G5 Major 1: an alignment tag split across lines (`<p` newline `align="center">`) or followed by a
 * space that trim() removes slipped past both nesting checks, so a short post nesting ~480
 * blockquotes was parsed synchronously in render and blocked the main thread for 240-580 ms on
 * every view. Such text is now over the limits and shows as plain text, cheaply.
 */
const deep = '> '.repeat(480);
const PAYLOADS = [
    `<p\nalign="center">${deep}x</p>`,
    `<p\r\nalign="center">\r\n${deep}x</p>`,
    `<div\nalign='right'\n>${deep}x</div>`,
    `<p align="center">\u00a0${deep}x</p>`,
    `<p align="center">\ufeff${deep}x</p>`,
];
// Generous for slow CI; the bug cost 240-580 ms per render on a fast machine.
const RENDER_BUDGET_MS = 100;

describe('split alignment tags cannot smuggle deep nesting into a synchronous parse', () => {
    it.each(PAYLOADS)('%j is short enough for the synchronous path but over the limits', (source) => {
        expect(source.length).toBeLessThanOrEqual(SYNC_MAX_LENGTH);
        expect(exceedsContainerLimits(source)).toBe(true);
    });

    it.each(PAYLOADS)('%j renders as plain text within the budget', (source) => {
        // Warm up module-level work once so the measurement is the render itself.
        render(<MemoryRouter><MarkdownRenderer mode="markdown" content="warm up" /></MemoryRouter>);
        const started = performance.now();
        const { container } = render(
            <MemoryRouter><MarkdownRenderer mode="markdown" content={source} /></MemoryRouter>,
        );
        const elapsed = performance.now() - started;
        expect(container.querySelector('blockquote')).toBeNull();
        expect(container.textContent).toContain('align=');
        expect(elapsed).toBeLessThan(RENDER_BUDGET_MS);
    });
});
