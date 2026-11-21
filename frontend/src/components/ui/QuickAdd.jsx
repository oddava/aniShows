import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import useMediaQuery from '../../hooks/useMediaQuery';
import useDelayedLoading from '../../hooks/useDelayedLoading';
import { statusMeta } from '../../utils/listStatus';
import BottomSheet from './BottomSheet';
import { ScoreStep, StatusOptions } from './StatusMenu';

const TOUCH_QUERY = '(hover: none), (pointer: coarse), (max-width: 639px)';

/**
 * The status button on every card (T1): "+" when the show is not on the
 * list, the status colour when it is. Opens the status menu in place: a
 * popover with a pointer, a bottom sheet on touch screens (M2). Picking
 * Completed turns the menu into a one-tap score row.
 *
 * Presentational: the card owns the writes (`onSelect`, `onScore`, `onRemove`).
 */
/** The line under Completed: what it will do to progress, or nothing. */
function completeHint(watched, total, aired) {
    if (aired && (!total || aired < total)) {
        return watched < aired ? `marks the ${aired} aired episodes watched` : null;
    }
    return total && watched < total ? `marks all ${total} watched` : null;
}

export default function QuickAdd({
    status,
    score = 0,
    title,
    onSelect,
    onScore,
    onRemove,
    pending = false,
    className = 'relative',
    placement = 'up',
    variant = 'icon',
    watched = 0,
    total = null,
    aired = null,
    quiet = false,
    compact = false,
    labelFrom = null,
}) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState('status');
    const isTouch = useMediaQuery(TOUCH_QUERY);
    // A menu that would stick out of the content column (first or last
    // column) slides in just enough to stay inside it.
    const menuRef = useRef(null);
    const [nudge, setNudge] = useState(0);
    useLayoutEffect(() => {
        if (!open) {
            setNudge(0);
            return;
        }
        const menu = menuRef.current;
        const rect = menu?.getBoundingClientRect?.();
        if (!rect) return;
        // Keep it inside the content column (the page's padding box), on both
        // sides: under the + where it fits, nudged in where it would not.
        // The column is the card's grid: the first ancestor clearly wider
        // than the card (rows: the page container).
        const card = menu.closest('article');
        let column = null;
        if (card) {
            const cardWidth = card.getBoundingClientRect().width;
            column = card.parentElement;
            while (column && column.getBoundingClientRect().width < cardWidth * 2.5) column = column.parentElement;
        } else {
            column = menu.closest('.page-container');
        }
        let left = 16;
        let right = window.innerWidth - 16;
        if (column) {
            const box = column.getBoundingClientRect();
            const style = window.getComputedStyle(column);
            left = Math.max(left, box.left + parseFloat(style.paddingLeft || 0));
            right = Math.min(right, box.right - parseFloat(style.paddingRight || 0));
        }
        const shift = rect.left < left ? left - rect.left : rect.right > right ? right - rect.right : 0;
        if (shift !== 0) setNudge(shift);
    }, [open]);
    const wrapRef = useRef(null);
    const buttonRef = useRef(null);
    const menuId = useId();
    const meta = statusMeta(status);
    // Writes are optimistic: only a slow one earns a spinner.
    const showSpinner = useDelayedLoading(pending, 400);

    const close = ({ focus = true } = {}) => {
        setOpen(false);
        setStep('status');
        if (focus) buttonRef.current?.focus();
    };

    useEffect(() => {
        if (!open || isTouch) return undefined;
        const onPointer = (event) => {
            if (!wrapRef.current?.contains(event.target)) close({ focus: false });
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, isTouch]);

    const stop = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const handleSelect = (value) => {
        onSelect?.(value);
        if (value === 'Completed' && onScore && !score) {
            setStep('score');
            return;
        }
        close();
    };

    const handleScore = (value) => {
        onScore?.(value);
        close();
    };

    const handleRemove = () => {
        onRemove?.();
        close();
    };

    const body = step === 'score'
        ? <ScoreStep value={score} onScore={handleScore} onSkip={() => close()} />
        : (
            <StatusOptions
                current={status}
                onSelect={handleSelect}
                onRemove={onRemove ? handleRemove : undefined}
                autoFocus
                // Say what Completed does to progress before it happens: every
                // episode, or every aired one while the show is still airing.
                completeHint={completeHint(watched, total, aired)}
            />
        );

    const label = meta ? `${meta.label}. Change list status for ${title}` : `Add ${title} to your list`;

    return (
        <div
            ref={wrapRef}
            className={className}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
                if (!isTouch && open && event.relatedTarget && !wrapRef.current?.contains(event.relatedTarget)) {
                    close({ focus: false });
                }
            }}
        >
            <button
                ref={buttonRef}
                type="button"
                onClick={(event) => {
                    stop(event);
                    if (open) close();
                    else setOpen(true);
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open && !isTouch ? menuId : undefined}
                aria-label={label}
                title={variant === 'icon' ? (meta ? meta.label : 'Add to list') : undefined}
                className={variant === 'chip'
                    ? `inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg ${compact && meta ? 'w-11 justify-center' : labelFrom === 'sm' ? 'max-sm:w-11 max-sm:justify-center sm:px-3' : 'px-3'} text-sm font-medium transition-colors duration-150 touch-manipulation ${meta ? (quiet ? 'text-[var(--text-2)] hover:bg-white/[0.06] hover:text-[var(--text-1)]' : 'bg-white/[0.06] text-[var(--text-1)] hover:bg-white/[0.1]') : 'bg-[var(--signature-soft)] text-[var(--signature)] hover:bg-[rgb(141_177_255/0.2)]'}`
                    : variant === 'button'
                    ? `flex h-11 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3.5 text-sm font-semibold transition-colors duration-150 touch-manipulation ${meta ? 'bg-white/[0.07] text-white hover:bg-white/[0.11]' : 'bg-[var(--signature)] text-[var(--on-signature)] hover:bg-[var(--signature-hover)]'}`
                    : `quick-add relative flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[rgb(27_31_37/0.88)] text-[var(--text-1)] backdrop-blur-sm transition-colors duration-150 hover:bg-[rgb(40_46_54/0.95)] after:absolute after:-inset-1.5 after:content-[''] touch-manipulation ${meta && !compact ? 'px-2.5 text-[12.5px] font-medium' : 'w-8'}`}
            >
                {variant === 'chip' && compact && meta ? (
                    showSpinner
                        ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        : <ChevronDown aria-hidden="true" className="h-4 w-4" />
                ) : variant === 'chip' ? (
                    <>
                        {showSpinner ? (
                            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        ) : meta ? (
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                        ) : (
                            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
                        )}
                        <span className={labelFrom === 'sm' ? 'hidden sm:inline' : undefined}>{meta ? meta.label : 'Add'}</span>
                    </>
                ) : variant === 'button' ? (
                    <>
                        {showSpinner ? (
                            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        ) : meta ? (
                            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                        ) : (
                            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
                        )}
                        <span className="flex-1 text-left">{meta ? meta.label : 'Add to list'}</span>
                        <ChevronDown aria-hidden="true" className={`h-4 w-4 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                    </>
                ) : showSpinner ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : meta ? (
                    <>
                        <span aria-hidden="true" className={`${compact ? 'h-2.5 w-2.5' : 'h-2 w-2'} shrink-0 rounded-full`} style={{ backgroundColor: meta.color }} />
                        {!compact && <span aria-hidden="true">{meta.label}</span>}
                    </>
                ) : (
                    <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
                )}
            </button>

            {open && !isTouch && (
                <div
                    id={menuId}
                    ref={menuRef}
                    style={variant === 'button' || !nudge ? undefined : { right: -nudge }}
                    className={`popover-in absolute ${variant === 'button' ? 'left-0 right-0 min-w-52' : 'right-0 w-52'} z-[300] rounded-[var(--radius-md)] bg-[var(--ink-3)] p-1 shadow-[var(--shadow-pop)] ${placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                >
                    {variant === 'icon' && title && (
                        <p className="truncate px-3 pt-1.5 pb-1 text-[13px] text-[var(--text-2)]">{title}</p>
                    )}
                    {body}
                </div>
            )}

            {isTouch && (
                <BottomSheet open={open} onClose={() => close()} title={title}>
                    {body}
                </BottomSheet>
            )}
        </div>
    );
}
