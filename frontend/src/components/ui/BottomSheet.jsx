import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const CLOSE_MS = 160;

/**
 * A small centred dialog for menus and quick choices (it was a sheet that
 * rose from the bottom edge; the name stays so callers don't change).
 * Escape or the backdrop closes it; focus is trapped inside and returns to
 * the opener. It fades and settles in (.modal-panel), a plain swap with
 * reduced motion.
 */
export default function BottomSheet({ open, onClose, title, children, footer, labelledBy }) {
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);
    const headingId = useId();

    useEffect(() => {
        if (open) {
            setMounted(true);
            setClosing(false);
            return undefined;
        }
        if (!mounted) return undefined;
        setClosing(true);
        const timer = setTimeout(() => {
            setMounted(false);
            setClosing(false);
        }, CLOSE_MS);
        return () => clearTimeout(timer);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // No page scroll behind an open dialog, and toasts move to the top of
    // the screen so they never sit on its controls (index.css).
    useEffect(() => {
        if (!open) return undefined;
        const root = document.documentElement;
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';
        root.dataset.sheetOpen = 'true';
        return () => {
            document.body.style.overflow = overflow;
            delete root.dataset.sheetOpen;
        };
    }, [open]);

    const handleEscape = useCallback(() => onClose?.(), [onClose]);
    const trapRef = useFocusTrap(open && mounted, handleEscape);

    if (!mounted || typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
            data-state={closing ? 'closing' : 'open'}
        >
            <div
                aria-hidden="true"
                onClick={() => onClose?.()}
                className="sheet-backdrop absolute inset-0 bg-black/60"
            />
            <div
                ref={trapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy || (title ? headingId : undefined)}
                className="sheet-panel modal-panel relative max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--ink-2)] py-3 shadow-[var(--shadow-pop)]"
            >
                {title && (
                    <h2 id={headingId} className="line-clamp-2 px-5 pb-2 pt-1 text-base font-semibold text-[var(--text-1)]">
                        {title}
                    </h2>
                )}
                <div className="px-3">{children}</div>
                {footer && <div className="px-5 pt-3">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}
