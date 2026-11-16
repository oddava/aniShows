import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MarkdownRenderer from '../../common/MarkdownRenderer';
import { buildCommunityTree } from '../communityMarkdownTree';
import { BUDGET_MS, SYNC_MAX_LENGTH, resetCommunityTreeCache } from '../useCommunityTree';

/** Stands in for the parse worker: records jobs; tests answer (or don't) by hand. */
class FakeWorker {
    static instances = [];

    constructor() {
        this.jobs = [];
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    postMessage(job) {
        this.jobs.push(job);
    }

    reply(job) {
        this.onmessage({ data: { id: job.id, tree: buildCommunityTree(job.source) } });
    }

    terminate() {
        this.terminated = true;
    }
}

const long = (markdown) => `${markdown}\n\n${'plain words '.repeat(Math.ceil(SYNC_MAX_LENGTH / 12))}`;

const renderMarkdown = (content) => render(
    <MemoryRouter>
        <MarkdownRenderer mode="markdown" content={content} />
    </MemoryRouter>,
);

beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    resetCommunityTreeCache();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetCommunityTreeCache();
});

describe('community markdown parse budget', () => {
    it('parses short text right away, without the worker', () => {
        const { container } = renderMarkdown('**bold**');
        expect(container.querySelector('strong')).toHaveTextContent('bold');
        expect(FakeWorker.instances).toHaveLength(0);
    });

    it('shows long text as plain text while the worker parses it, then the markdown', async () => {
        const source = long('**bold**');
        const { container } = renderMarkdown(source);
        expect(container.querySelector('strong')).toBeNull();
        expect(container.textContent).toContain('**bold**');

        const [worker] = FakeWorker.instances;
        await act(async () => worker.reply(worker.jobs[0]));

        expect(container.querySelector('strong')).toHaveTextContent('bold');
    });

    it('abandons a parse past the budget: worker terminated, text stays plain, no retry', async () => {
        vi.useFakeTimers();
        const source = long('*a'.repeat(50));
        const { container, unmount } = renderMarkdown(source);
        const [worker] = FakeWorker.instances;

        await act(async () => vi.advanceTimersByTime(BUDGET_MS + 1));

        expect(worker.terminated).toBe(true);
        expect(container.textContent).toContain('*a*a');
        expect(container.querySelector('em')).toBeNull();
        unmount();
        renderMarkdown(source);
        expect(FakeWorker.instances).toHaveLength(1); // cached as failed: not parsed again
    });

    it('runs one job at a time, each with its own budget', async () => {
        renderMarkdown(long('first'));
        renderMarkdown(long('second'));
        const [worker] = FakeWorker.instances;
        expect(worker.jobs).toHaveLength(1);

        await act(async () => worker.reply(worker.jobs[0]));

        expect(worker.jobs).toHaveLength(2);
        expect(worker.jobs[1].source).toContain('second');
    });

    it('keeps hostile long text off the main thread', () => {
        const started = performance.now();
        const { container } = renderMarkdown('*a'.repeat(10_000));
        expect(performance.now() - started).toBeLessThan(500);
        expect(container.textContent).toHaveLength(20_000);
    });

    it('shows plain text when the worker reports a failure', async () => {
        const source = long('**x**');
        const { container } = renderMarkdown(source);
        const [worker] = FakeWorker.instances;

        await act(async () => worker.onmessage({ data: { id: worker.jobs[0].id, failed: true } }));

        expect(container.querySelector('strong')).toBeNull();
        expect(container.textContent).toContain('**x**');
    });
});

// The hostile shapes measured during council review: seconds to parse at 20k characters.
const N = 20_000;
const fill = (unit) => unit.repeat(Math.floor(N / unit.length));
const HOSTILE = {
    emphasis: fill('*a'),
    strike: fill('~a'),
    linkClosers: fill(']('),
    linkOpeners: fill('[a]('),
    wideTable: `${'|a'.repeat(N / 4)}\n${'|-'.repeat(N / 4)}`,
    tableRows: `|a|b|\n|-|-|\n${fill('|x|y|\n')}`,
    longList: fill('* a\n'),
    footnoteNesting: `[^a]: ${'- '.repeat(5000)}x`,
    bareCr: `a\r${'- '.repeat(5000)}x`,
    alignedNesting: `a<p align="center">${'- '.repeat(5000)}x</p>`,
    autolinkDots: `a.com/${'.'.repeat(N - 6)}`,
};

describe('hostile 20k-character text never blocks the main thread', () => {
    it.each(Object.entries(HOSTILE))('%s renders as plain text within the budget', (_name, source) => {
        const started = performance.now();
        const { container, unmount } = renderMarkdown(source);
        expect(performance.now() - started).toBeLessThan(300);
        expect(container.textContent).toBe(source.replace(/\r/g, '\r'));
        unmount();
    });

    it('parses the first 1,000 characters of each shape on the main thread quickly', () => {
        // Parse cost only (rendering into jsdom is far slower than a browser and not what's bounded).
        for (const source of Object.values(HOSTILE)) {
            const short = source.slice(0, SYNC_MAX_LENGTH);
            buildCommunityTree(short); // warm
            const started = performance.now();
            buildCommunityTree(short);
            expect(performance.now() - started).toBeLessThan(300);
        }
    });
});
