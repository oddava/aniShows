import { useEffect, useReducer } from 'react';

import { buildCommunityTree } from './communityMarkdownTree';

/*
 * Community markdown under a time budget. Forum text is hostile and the markdown parser has
 * slow paths (quadratic emphasis, wide tables, long lists): a 20k-character post can take seconds,
 * on every viewer's main thread. So:
 *   - short text (≤ SYNC_MAX_LENGTH, measured worst case ~60 ms) is parsed right away, in render;
 *   - longer text is parsed in a worker, one job at a time; a job over BUDGET_MS is abandoned (the
 *     worker is terminated, which stops it) and that text is shown as plain text.
 * Until a long text's tree arrives it is shown as plain text, so nothing is ever hidden.
 * Results are cached per source, so re-renders and repeated posts cost nothing.
 */

export const SYNC_MAX_LENGTH = 1_000;
export const BUDGET_MS = 300;
const CACHE_LIMIT = 300;

const cache = new Map(); // source -> { tree } | { failed: true }
const queue = [];
let worker = null;
let running = null; // { id, source, resolve, timer }
let nextId = 0;

const remember = (source, result) => {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(source, result);
    return result;
};

const parseNow = (source) => {
    try {
        return { tree: buildCommunityTree(source) };
    } catch {
        return { failed: true };
    }
};

const dropWorker = () => {
    worker?.terminate();
    worker = null;
};

const finish = (result) => {
    const job = running;
    running = null;
    clearTimeout(job.timer);
    job.resolve(remember(job.source, result));
    runNext();
};

const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL('./communityMarkdown.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
        if (running && data?.id === running.id) finish(data.failed ? { failed: true } : { tree: data.tree });
    };
    worker.onerror = () => {
        dropWorker();
        if (running) finish({ failed: true });
    };
    return worker;
};

function runNext() {
    if (running || !queue.length) return;
    const job = queue.shift();
    const cached = cache.get(job.source);
    if (cached) {
        job.resolve(cached);
        runNext();
        return;
    }
    running = { ...job, id: nextId++ };
    running.timer = setTimeout(() => {
        // Over budget: terminating the worker is the only way to stop the parse.
        dropWorker();
        finish({ failed: true });
    }, BUDGET_MS);
    try {
        ensureWorker().postMessage({ id: running.id, source: job.source });
    } catch {
        dropWorker();
        finish({ failed: true });
    }
}

const parseInWorker = (source) => new Promise((resolve) => {
    queue.push({ source, resolve });
    runNext();
});

const usesWorker = (source) => source.length > SYNC_MAX_LENGTH && typeof Worker !== 'undefined';

/**
 * `{ tree }` (render it), `{ failed: true }` (show plain text) or `{ pending: true }` (show plain
 * text for now; the component re-renders when the tree is ready).
 */
export function useCommunityTree(source) {
    const [, rerender] = useReducer((count) => count + 1, 0);
    const cached = cache.get(source);
    const needsWorker = !cached && usesWorker(source);

    useEffect(() => {
        if (!needsWorker) return undefined;
        let mounted = true;
        parseInWorker(source).then(() => {
            if (mounted) rerender();
        });
        return () => {
            mounted = false;
        };
    }, [source, needsWorker]);

    if (cached) return cached;
    if (needsWorker) return { pending: true };
    return remember(source, parseNow(source));
}

/** Test helper: forget cached trees and any worker state. */
export function resetCommunityTreeCache() {
    cache.clear();
    queue.length = 0;
    if (running) clearTimeout(running.timer);
    running = null;
    dropWorker();
}
