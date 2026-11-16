import { useEffect, useReducer } from 'react';

import { buildCommunityTree } from './communityMarkdownTree';

/*
 * Community markdown under a time budget. Forum text is hostile and the markdown parser has
 * slow paths (quadratic emphasis, wide tables, long lists): a 20k-character post can take seconds,
 * on every viewer's main thread. So:
 *   - short, table-free text (≤ SYNC_MAX_LENGTH, ≤ SYNC_MAX_PIPES `|`) is parsed right away, in render;
 *   - other text is parsed in a worker, one job at a time; a job over its budget is abandoned (the
 *     worker is terminated, which stops it) and that text is shown as plain text.
 * The budget starts once the worker has loaded (it posts `{ ready: true }`), so fetching and
 * evaluating the worker never counts; the first job on a fresh worker also gets extra time for the
 * cold JIT. Trees are capped in size too (communityMarkdownTree.js), so what reaches the main thread
 * stays cheap to render. Until a tree arrives the text is shown as plain text, so nothing is hidden.
 * Results are cached per source (LRU), so re-renders and repeated posts cost nothing.
 * Browsers without module workers (e.g. Firefox < 114) fail to start the worker and show long posts
 * as plain text: safe, just unformatted.
 */

export const SYNC_MAX_LENGTH = 1_000;
// Tables cost far more than their length suggests (rows are padded to the header's columns).
export const SYNC_MAX_PIPES = 32;
export const BUDGET_MS = 300;
export const COLD_START_BUDGET_MS = 3 * BUDGET_MS;
export const STARTUP_TIMEOUT_MS = 10_000;
const CACHE_LIMIT = 300;

const cache = new Map(); // source -> { tree } | { failed: true }
const queue = [];
let worker = null; // { instance, ready, completed, startupTimer }
let running = null; // { id, source, resolve, timer }
let nextId = 0;

const readCache = (source) => {
    const hit = cache.get(source);
    if (hit) {
        // Least recently used goes first: refresh this entry's position.
        cache.delete(source);
        cache.set(source, hit);
    }
    return hit;
};

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
    if (!worker) return;
    clearTimeout(worker.startupTimer);
    worker.instance.terminate();
    worker = null;
};

/** The worker never loaded: these texts stay plain for now (not cached, so a later mount retries). */
const failAllWithoutCaching = () => {
    dropWorker();
    const jobs = running ? [running, ...queue] : [...queue];
    if (running) clearTimeout(running.timer);
    running = null;
    queue.length = 0;
    jobs.forEach((job) => job.resolve({ failed: true }));
};

const finish = (result) => {
    const job = running;
    running = null;
    clearTimeout(job.timer);
    if (worker && 'tree' in result) worker.completed += 1;
    job.resolve(remember(job.source, result));
    runNext();
};

const ensureWorker = () => {
    if (worker) return worker;
    const instance = new Worker(new URL('./communityMarkdown.worker.js', import.meta.url), { type: 'module' });
    const current = { instance, ready: false, completed: 0, startupTimer: null };
    current.startupTimer = setTimeout(failAllWithoutCaching, STARTUP_TIMEOUT_MS);
    instance.onmessage = ({ data }) => {
        if (data?.ready) {
            clearTimeout(current.startupTimer);
            current.ready = true;
            runNext();
        } else if (running && data?.id === running.id) {
            finish(data.failed ? { failed: true } : { tree: data.tree });
        }
    };
    instance.onerror = () => {
        if (!current.ready) failAllWithoutCaching();
        else {
            dropWorker();
            if (running) finish({ failed: true });
        }
    };
    worker = current;
    return worker;
};

function runNext() {
    if (running || !queue.length) return;
    let current;
    try {
        current = ensureWorker();
    } catch {
        failAllWithoutCaching();
        return;
    }
    if (!current.ready) return; // runNext runs again on `ready`
    const job = queue.shift();
    const cached = readCache(job.source);
    if (cached) {
        job.resolve(cached);
        runNext();
        return;
    }
    running = { ...job, id: nextId++ };
    const budget = current.completed === 0 ? COLD_START_BUDGET_MS : BUDGET_MS;
    running.timer = setTimeout(() => {
        // Over budget: terminating the worker is the only way to stop the parse.
        dropWorker();
        finish({ failed: true });
    }, budget);
    current.instance.postMessage({ id: running.id, source: job.source });
}

const parseInWorker = (source) => new Promise((resolve) => {
    queue.push({ source, resolve });
    runNext();
});

const countPipes = (source) => {
    let pipes = 0;
    for (let index = source.indexOf('|'); index !== -1; index = source.indexOf('|', index + 1)) pipes += 1;
    return pipes;
};

const isCheap = (source) => source.length <= SYNC_MAX_LENGTH && countPipes(source) <= SYNC_MAX_PIPES;
const usesWorker = (source) => typeof Worker !== 'undefined' && !isCheap(source);

/**
 * `{ tree }` (render it), `{ failed: true }` (show plain text) or `{ pending: true }` (show plain
 * text for now; the component re-renders when the tree is ready).
 */
export function useCommunityTree(source) {
    const [, rerender] = useReducer((count) => count + 1, 0);
    const cached = readCache(source);
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
