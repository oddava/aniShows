import { useRef } from 'react';
import { X } from 'lucide-react';

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * One-tap scoring (T4): 1–10 as a 5×2 grid of 44 px targets (fits any
 * popover, sidebar or phone width); `layout="row"` for wide forms. Arrow keys move and pick like a radio
 * group; the chosen score and everything below it fill, so the row reads as
 * a bar. `value` 0 means unscored; Clear sets it back to 0.
 */
export default function ScorePicker({
    value = 0,
    onChange,
    disabled = false,
    label = 'Your score',
    allowClear = true,
    size = 'md',
    layout = 'grid',
    className = '',
}) {
    const refs = useRef([]);
    const current = Number(value) || 0;
    const small = size === 'sm';

    const pick = (score) => {
        if (disabled || score === current) return;
        onChange?.(score);
    };

    const onKeyDown = (event, index) => {
        const keys = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const next = Math.min(9, Math.max(0, index + keys[event.key]));
        refs.current[next]?.focus();
        pick(SCORES[next]);
    };

    // Roving tab stop: the chosen score, else 1.
    const tabStop = current > 0 ? current - 1 : 0;

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div
                role="radiogroup"
                aria-label={label}
                // "row" is one line from 640 px up; on phones it is the 5×2 grid too.
                className={layout === 'grid' ? 'grid flex-1 grid-cols-5 gap-1' : 'grid flex-1 grid-cols-5 gap-1 sm:flex'}
            >
                {SCORES.map((score, index) => {
                    const checked = score === current;
                    const filled = current > 0 && score <= current;
                    return (
                        <button
                            key={score}
                            ref={(node) => { refs.current[index] = node; }}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            aria-label={`${score} out of 10`}
                            tabIndex={index === tabStop ? 0 : -1}
                            disabled={disabled}
                            onClick={() => pick(score)}
                            onKeyDown={(event) => onKeyDown(event, index)}
                            className={`press flex flex-1 items-center justify-center rounded-[var(--radius-sm)] font-semibold tabular transition-colors duration-150 touch-manipulation disabled:opacity-40 ${small ? 'h-11 min-w-9 text-sm' : 'h-11 min-w-9 text-[15px]'} ${checked
                                ? 'bg-[var(--signature)] text-[var(--on-signature)]'
                                : filled
                                    ? 'bg-[var(--signature-soft)] text-[var(--signature)]'
                                    : 'bg-white/[0.05] text-gray-300 hover:bg-white/[0.1] hover:text-white'}`}
                        >
                            {score}
                        </button>
                    );
                })}
            </div>
            {allowClear && current > 0 && (
                <button
                    type="button"
                    onClick={() => onChange?.(0)}
                    disabled={disabled}
                    aria-label="Clear score"
                    className={`press flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-gray-400 hover:bg-white/[0.06] hover:text-white h-11 w-11`}
                >
                    <X aria-hidden="true" className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}
