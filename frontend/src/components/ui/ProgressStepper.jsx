import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/** Clamp an episode count to [0, total]; an unknown total only floors at 0. */
export function clampEpisodes(value, total) {
    const n = Math.max(0, Math.trunc(Number(value) || 0));
    const max = Number(total) > 0 ? Number(total) : null;
    return max === null ? n : Math.min(n, max);
}

/** "13 / 24", "13 / 1180 aired" when the total is unknown, else "13 / ?" (D2). */
export function progressLabel(value, total, aired) {
    if (Number(total) > 0) return { current: value, rest: `/ ${total}` };
    if (Number(aired) > 0) return { current: value, rest: `/ ${aired} aired` };
    return { current: value, rest: '/ ?' };
}

/**
 * `− 13 / 24 +` (T3, T4). Taps are counted locally and written once the
 * burst settles (`commitDelay`), so five quick taps are one write and one
 * toast. `onCommit(next, previous)` may return a promise; taps made while it
 * runs are written after it. Clamped to the known episode count.
 */
export default function ProgressStepper({
    value = 0,
    total,
    aired,
    onCommit,
    disabled = false,
    size = 'md',
    commitDelay = 450,
    title = '',
    className = '',
    onDraft,
}) {
    const [draft, setDraft] = useState(null);
    const draftRef = useRef(null);
    const burstStart = useRef(null);
    const timer = useRef(null);
    const pending = useRef(null);
    const onCommitRef = useRef(onCommit);

    const shown = draft ?? value;
    const max = Number(total) > 0 ? Number(total) : null;

    useEffect(() => {
        onCommitRef.current = onCommit;
    }, [onCommit]);

    // Tell the parent what is on screen during a burst (null when settled), so
    // text around the stepper can follow the tap before the write lands.
    const onDraftRef = useRef(onDraft);
    useEffect(() => {
        onDraftRef.current = onDraft;
    }, [onDraft]);
    useEffect(() => {
        onDraftRef.current?.(draft);
    }, [draft]);

    // Leaving the page mid-burst still saves the taps (they were acknowledged).
    useEffect(() => () => {
        if (timer.current === null) return;
        clearTimeout(timer.current);
        timer.current = null;
        const next = draftRef.current;
        const previous = burstStart.current;
        if (next !== null && previous !== null && next !== previous) onCommitRef.current?.(next, previous);
    }, []);

    // The saved value caught up with what was typed: drop the draft.
    useEffect(() => {
        if (draftRef.current !== null && !pending.current && timer.current === null && draftRef.current === value) {
            draftRef.current = null;
            setDraft(null);
        }
    }, [value]);

    const flush = useCallback(async () => {
        timer.current = null;
        const next = draftRef.current;
        const previous = burstStart.current;
        if (next === null || next === previous) {
            draftRef.current = null;
            burstStart.current = null;
            setDraft(null);
            return;
        }
        burstStart.current = null;
        const run = Promise.resolve(onCommitRef.current?.(next, previous));
        pending.current = run;
        try {
            await run;
        } finally {
            pending.current = null;
            // More taps arrived while this write ran: write them too.
            if (burstStart.current !== null) {
                timer.current = setTimeout(flush, commitDelay);
            } else {
                draftRef.current = null;
                setDraft(null);
            }
        }
    }, [commitDelay]);

    const step = (delta) => {
        const base = draftRef.current ?? value;
        const next = clampEpisodes(base + delta, max);
        if (next === base) return;
        if (burstStart.current === null) burstStart.current = base;
        draftRef.current = next;
        setDraft(next);
        clearTimeout(timer.current);
        if (pending.current) {
            timer.current = null;
            return; // flush() picks it up when the running write ends
        }
        timer.current = setTimeout(flush, commitDelay);
    };

    const { current, rest } = progressLabel(shown, total, aired);
    const small = size === 'sm';
    const btn = small
        ? 'relative h-7 w-7 after:absolute after:-inset-2 after:content-[""]'
        : 'h-11 w-11';
    const name = title ? ` of ${title}` : '';

    return (
        <div
            className={`inline-flex items-center rounded-[var(--radius-md)] bg-white/[0.05] ${small ? 'gap-1 p-0.5' : 'gap-1 p-1'} ${className}`}
            role="group"
            aria-label={`Episodes watched${name}`}
        >
            <button
                type="button"
                onClick={() => step(-1)}
                disabled={disabled || shown <= 0}
                aria-label={`One episode less${name}`}
                className={`${btn} flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent touch-manipulation`}
            >
                <Minus aria-hidden="true" className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </button>
            <span
                className={`min-w-0 whitespace-nowrap px-1 text-center tabular ${small ? 'text-xs' : 'text-sm'}`}
                aria-live="polite"
            >
                <span className="font-semibold text-white">{current}</span>{' '}
                <span className="text-gray-400">{rest}</span>
            </span>
            <button
                type="button"
                onClick={() => step(1)}
                disabled={disabled || (max !== null && shown >= max)}
                aria-label={`One episode more${name}`}
                className={`${btn} flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--signature-soft)] text-[var(--signature)] transition-colors hover:bg-[var(--signature)] hover:text-[var(--on-signature)] disabled:opacity-30 disabled:hover:bg-[var(--signature-soft)] disabled:hover:text-[var(--signature)] touch-manipulation`}
            >
                <Plus aria-hidden="true" className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </button>
        </div>
    );
}
