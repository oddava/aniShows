import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import useMediaQuery from '../../hooks/useMediaQuery';
import useDelayedLoading from '../../hooks/useDelayedLoading';
import { statusMeta } from '../../utils/listStatus';
import BottomSheet from './BottomSheet';
import { ScoreStep, StatusOptions } from './StatusMenu';

const TOUCH_QUERY = '(hover: none), (pointer: coarse)';

/**
 * The status button on every card (T1): "+" when the show is not on the
 * list, the status colour when it is. Opens the status menu in place: a
 * popover with a pointer, a bottom sheet on touch screens (M2). Picking
 * Completed turns the menu into a one-tap score row.
 *
 * Presentational: the card owns the writes (`onSelect`, `onScore`, `onRemove`).
 */
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
}) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState('status');
    const isTouch = useMediaQuery(TOUCH_QUERY);
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
                // Completed means every episode: say so before it happens.
                completeHint={total && watched < total ? `marks all ${total} watched` : null}
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
                className={variant === 'button'
                    ? `flex h-11 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3.5 text-sm font-semibold transition-colors duration-150 touch-manipulation ${meta ? 'bg-white/[0.07] text-white hover:bg-white/[0.11]' : 'bg-[var(--signature)] text-[var(--on-signature)] hover:bg-[var(--signature-hover)]'}`
                    : "quick-add relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(11_13_16/0.78)] text-white backdrop-blur-sm transition-colors duration-150 hover:bg-[rgb(11_13_16/0.92)] after:absolute after:-inset-1.5 after:content-[''] touch-manipulation"}
            >
                {variant === 'button' ? (
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
                    <span aria-hidden="true" className="h-3 w-3 rounded-full ring-2 ring-[rgb(11_13_16/0.6)]" style={{ backgroundColor: meta.color }} />
                ) : (
                    <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
                )}
            </button>

            {open && !isTouch && (
                <div
                    id={menuId}
                    className={`popover-in absolute ${variant === 'button' ? 'left-0 right-0 min-w-52' : 'right-0 w-52'} z-[300] rounded-[var(--radius-md)] bg-[var(--ink-3)] p-1 shadow-[var(--shadow-pop)] ${placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                >
                    {variant === 'icon' && title && (
                        <p className="truncate px-3 pt-1.5 pb-1 text-[13px] text-[var(--text-3)]">{title}</p>
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
