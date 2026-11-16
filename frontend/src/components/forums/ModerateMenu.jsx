import { useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Staff-only "Moderate" disclosure: a small icon button that opens a list of
 * actions. Escape or a click outside closes it and returns focus to the
 * button. Each action is `{ label, onSelect, danger?, disabled? }`; the
 * caller does its own confirmation.
 */
export default function ModerateMenu({ actions, label = 'Moderate' }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const buttonRef = useRef(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const visibleActions = actions.filter(Boolean);
    if (!visibleActions.length) return null;

    return (
        <div ref={rootRef} className="relative">
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls={menuId}
                aria-label={label}
                title={label}
                className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${open ? 'text-white' : 'text-gray-500 hover:text-white'}`}
            >
                <ShieldCheck size={14} />
            </button>
            {open && (
                <div
                    id={menuId}
                    className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-xl border border-white/[0.08] bg-dark-100 p-1 shadow-lg"
                >
                    {visibleActions.map((action) => (
                        <button
                            key={action.label}
                            type="button"
                            disabled={action.disabled}
                            onClick={() => {
                                setOpen(false);
                                action.onSelect();
                            }}
                            className={`block w-full text-left px-3 py-1.5 text-xs font-medium rounded-lg transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed ${action.danger ? 'text-red-400' : 'text-gray-300 hover:text-white'}`}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Ask for an optional removal reason; `null` means the moderator cancelled. */
export const promptRemovalReason = (what) => {
    const reason = window.prompt(`Remove this ${what}? You can add a reason (optional):`, '');
    if (reason === null) return null;
    return reason.trim().slice(0, 200);
};
