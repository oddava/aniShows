import { useEffect, useId, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';

/**
 * Reactions the standard way: only the reactions someone used show, as chips
 * (yours highlighted; click to toggle), plus one button that opens a small
 * picker. Escape or a click outside closes the picker and returns focus.
 *
 * `reactions`: every available reaction ({ type, emoji, count, active }).
 */
export default function ReviewReactions({ reactions, onReact, canReact, pending, disabledTitle, labelFor }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const pickerId = useId();
    const used = reactions.filter((reaction) => (reaction.count || 0) > 0 || reaction.active);

    useEffect(() => {
        if (!open) return undefined;
        const close = (returnFocus) => {
            setOpen(false);
            if (returnFocus) triggerRef.current?.focus();
        };
        const onPointerDown = (event) => {
            if (!rootRef.current?.contains(event.target)) close(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close(true);
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const pick = (type) => {
        setOpen(false);
        triggerRef.current?.focus();
        onReact(type);
    };

    if (!used.length && !canReact) return null;

    return (
        <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
            {used.map((reaction) => (
                <button
                    key={reaction.type}
                    type="button"
                    onClick={() => onReact(reaction.type)}
                    disabled={!canReact || pending}
                    aria-label={`${labelFor(reaction)} (${reaction.count || 0})`}
                    aria-pressed={Boolean(reaction.active)}
                    title={canReact ? labelFor(reaction) : disabledTitle}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] tabular transition-colors ${reaction.active
                        ? 'border-accent/40 bg-accent/10 text-white'
                        : 'border-gray-800/60 bg-dark-50/60 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                        } ${canReact ? 'cursor-pointer' : 'cursor-default'}`}
                >
                    <span className="text-sm leading-none">{reaction.emoji}</span>
                    <span>{reaction.count || 0}</span>
                </button>
            ))}

            {canReact && (
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    disabled={pending}
                    aria-label="Add a reaction"
                    aria-haspopup="true"
                    aria-expanded={open}
                    aria-controls={open ? pickerId : undefined}
                    title="Add a reaction"
                    className={`flex h-[26px] w-[34px] items-center justify-center rounded-full border text-gray-500 transition-colors hover:border-gray-700 hover:text-gray-200 ${open ? 'border-gray-700 text-gray-200' : 'border-gray-800/60'}`}
                >
                    <SmilePlus className="h-3.5 w-3.5" />
                </button>
            )}

            {open && (
                <div
                    id={pickerId}
                    role="group"
                    aria-label="Reactions"
                    className="popover-in absolute bottom-full left-0 z-30 mb-2 flex gap-0.5 rounded-full bg-[var(--ink-2)] p-1 shadow-[var(--shadow-pop)]"
                >
                    {reactions.map((reaction) => (
                        <button
                            key={reaction.type}
                            type="button"
                            onClick={() => pick(reaction.type)}
                            aria-label={labelFor(reaction)}
                            aria-pressed={Boolean(reaction.active)}
                            title={labelFor(reaction)}
                            className={`flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none transition-transform duration-150 ease-out hover:scale-125 focus-visible:scale-125 ${reaction.active ? 'bg-white/10' : ''}`}
                        >
                            {reaction.emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
