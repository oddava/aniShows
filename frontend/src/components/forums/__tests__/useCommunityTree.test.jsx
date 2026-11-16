import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MarkdownRenderer from '../../common/MarkdownRenderer';
import { MAX_TREE_ELEMENTS, TreeTooLargeError, buildCommunityTree } from '../communityMarkdownTree';
import {
    BUDGET_MS,
    COLD_START_BUDGET_MS,
    STARTUP_TIMEOUT_MS,
    SYNC_MAX_LENGTH,
    resetCommunityTreeCache,
} from '../useCommunityTree';

/** Stands in for the parse worker: records jobs; tests decide when it is ready and how it answers. */
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

    ready() {
        this.onmessage({ data: { ready: true } });
    }

    /** Answer like the real worker does: the tree, or `failed` when building it throws. */
    reply(job = this.jobs.at(-1)) {
        let data;
        try {
            data = { id: job.id, tree: buildCommunityTree(job.source) };
        } catch {
            data = { id: job.id, failed: true };
        }
        this.onmessage({ data });
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

const readyWorker = async () => {
    const worker = FakeWorker.instances.at(-1);
    await act(async () => worker.ready());
    return worker;
};

// A table of `columns` × `rows`: GFM pads every row to the header, so it expands far past its length.
const table = (columns, rows) => `${'a|'.repeat(columns)}a\n${'-|'.repeat(columns)}-\n${'x\n'.repeat(rows)}`.trimEnd();

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
    it('parses short, table-free text right away, without the worker', () => {
        const { container } = renderMarkdown('**bold**');
        expect(container.querySelector('strong')).toHaveTextContent('bold');
        expect(FakeWorker.instances).toHaveLength(0);
    });

    it('shows long text as plain text while the worker parses it, then the markdown', async () => {
        const { container } = renderMarkdown(long('**bold**'));
        expect(container.querySelector('strong')).toBeNull();
        expect(container.textContent).toContain('**bold**');

        const worker = await readyWorker();
        await act(async () => worker.reply());

        expect(container.querySelector('strong')).toHaveTextContent('bold');
    });

    it('sends nothing, and starts no budget, until the worker has loaded', async () => {
        vi.useFakeTimers();
        renderMarkdown(long('**slow network**'));
        const [worker] = FakeWorker.instances;

        await act(async () => vi.advanceTimersByTime(STARTUP_TIMEOUT_MS - 1));
        expect(worker.jobs).toHaveLength(0);
        expect(worker.terminated).toBe(false);

        await act(async () => worker.ready());
        expect(worker.jobs).toHaveLength(1);
    });

    it('gives up on a worker that never loads, without caching a failure', async () => {
        vi.useFakeTimers();
        const source = long('**x**');
        const first = renderMarkdown(source);
        const [stuck] = FakeWorker.instances;

        await act(async () => vi.advanceTimersByTime(STARTUP_TIMEOUT_MS + 1));
        expect(stuck.terminated).toBe(true);
        expect(first.container.textContent).toContain('**x**');
        first.unmount();

        vi.useRealTimers();
        const second = renderMarkdown(source); // a later mount tries again
        const retry = await readyWorker();
        expect(retry).not.toBe(stuck);
        await act(async () => retry.reply());
        expect(second.container.querySelector('strong')).toHaveTextContent('x');
    });

    it('gives the first job on a fresh worker the cold-start budget, later jobs the normal one', async () => {
        vi.useFakeTimers();
        renderMarkdown(long('first'));
        renderMarkdown(long('second'));
        const worker = FakeWorker.instances[0];
        await act(async () => worker.ready());

        await act(async () => vi.advanceTimersByTime(BUDGET_MS + 1));
        expect(worker.terminated).toBe(false); // still inside COLD_START_BUDGET_MS
        await act(async () => worker.reply(worker.jobs[0]));

        await act(async () => vi.advanceTimersByTime(BUDGET_MS + 1));
        expect(worker.terminated).toBe(true);
        expect(COLD_START_BUDGET_MS).toBeGreaterThan(BUDGET_MS);
    });

    it('abandons a parse past the budget: worker terminated, text stays plain, no retry', async () => {
        vi.useFakeTimers();
        const source = long('*a'.repeat(50));
        const { container, unmount } = renderMarkdown(source);
        const worker = FakeWorker.instances[0];
        await act(async () => worker.ready());

        await act(async () => vi.advanceTimersByTime(COLD_START_BUDGET_MS + 1));

        expect(worker.terminated).toBe(true);
        expect(container.textContent).toContain('*a*a');
        expect(container.querySelector('em')).toBeNull();
        unmount();
        renderMarkdown(source);
        expect(FakeWorker.instances).toHaveLength(1); // cached as failed: not parsed again
    });

    it('runs one job at a time', async () => {
        renderMarkdown(long('first'));
        renderMarkdown(long('second'));
        const worker = await readyWorker();
        expect(worker.jobs).toHaveLength(1);

        await act(async () => worker.reply(worker.jobs[0]));

        expect(worker.jobs).toHaveLength(2);
        expect(worker.jobs[1].source).toContain('second');
    });

    it('shows plain text when the worker reports a failure', async () => {
        const { container } = renderMarkdown(long('**x**'));
        const worker = await readyWorker();

        await act(async () => worker.onmessage({ data: { id: worker.jobs[0].id, failed: true } }));

        expect(container.querySelector('strong')).toBeNull();
        expect(container.textContent).toContain('**x**');
    });
});

describe('tree size cap', () => {
    it('refuses to build a tree past MAX_TREE_ELEMENTS', () => {
        // 995 characters that expand to ~31,000 table cells (council round 5, input A).
        expect(() => buildCommunityTree(table(124, 248))).toThrow(TreeTooLargeError);
        expect(() => buildCommunityTree('- item\n'.repeat(100))).not.toThrow();
    });

    it('sends short tables to the worker and shows an oversized one as plain text', async () => {
        const source = table(124, 248);
        expect(source.length).toBeLessThanOrEqual(SYNC_MAX_LENGTH);
        const { container } = renderMarkdown(source);
        const worker = await readyWorker();
        expect(worker.jobs).toHaveLength(1); // not parsed on the main thread

        await act(async () => worker.reply());

        expect(container.querySelector('table')).toBeNull();
        expect(container.textContent).toBe(source);
    });

    it('renders an ordinary table from the worker', async () => {
        const { container } = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n'.repeat(20));
        const worker = await readyWorker();
        await act(async () => worker.reply());
        expect(container.querySelectorAll('table').length).toBeGreaterThan(0);
    });

    it('renders the largest accepted tree in bounded time', async () => {
        const items = Math.floor(MAX_TREE_ELEMENTS / 3) - 10; // li + a + text per item, under the cap
        const source = `${'- [a](https://x.example)\n'.repeat(items)}`;
        const { container } = renderMarkdown(source);
        const worker = await readyWorker();

        const started = performance.now();
        await act(async () => worker.reply());
        const elapsed = performance.now() - started;

        expect(container.querySelectorAll('li')).toHaveLength(items);
        // jsdom is several times slower than a browser; this bounds the order of magnitude.
        expect(elapsed).toBeLessThan(3_000);
    });
});

// The hostile shapes measured during council review: seconds to parse (or render) at 20k characters.
const N = 20_000;
const fill = (unit) => unit.repeat(Math.floor(N / unit.length));
const HOSTILE = {
    emphasis: fill('*a'),
    strike: fill('~a'),
    linkClosers: fill(']('),
    linkOpeners: fill('[a]('),
    wideTable: `${'|a'.repeat(N / 4)}\n${'|-'.repeat(N / 4)}`,
    tableRows: `|a|b|\n|-|-|\n${fill('|x|y|\n')}`,
    paddedTable: table(170, 400),
    shortPaddedTable: table(124, 248),
    longList: fill('* a\n'),
    footnoteNesting: `[^a]: ${'- '.repeat(5000)}x`,
    bareCr: `a\r${'- '.repeat(5000)}x`,
    alignedNesting: `a<p align="center">${'- '.repeat(5000)}x</p>`,
    autolinkDots: `a.com/${'.'.repeat(N - 6)}`,
};

describe('hostile text never blocks the main thread', () => {
    it.each(Object.entries(HOSTILE))('%s renders as plain text within the budget', (_name, source) => {
        const started = performance.now();
        const { container, unmount } = renderMarkdown(source);
        expect(performance.now() - started).toBeLessThan(300);
        expect(container.textContent).toBe(source);
        unmount();
    });

    it('parses the first 1,000 characters of each table-free shape on the main thread quickly', () => {
        // Parse cost only (rendering into jsdom is far slower than a browser and bounded separately).
        for (const source of Object.values(HOSTILE)) {
            const short = source.slice(0, SYNC_MAX_LENGTH);
            if (short.split('|').length - 1 > 32) continue; // tables always go to the worker
            buildCommunityTree(short); // warm
            const started = performance.now();
            buildCommunityTree(short);
            expect(performance.now() - started).toBeLessThan(300);
        }
    });
});
