import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const CLOSE_MS = 220;
const DISMISS_DRAG_PX = 90;
// A quick flick closes it too, even a short one (px per ms).
const DISMISS_VELOCITY = 0.5;
const FLICK_MIN_PX = 24;

/**
 * A sheet that rises from the bottom edge (touch screens: menus and filters).
 * Escape, the backdrop or a downward drag on the handle closes it; focus is
 * trapped inside and returns to the opener. Motion is a 200 ms slide that
 * reduced-motion turns into a plain swap.
 */
export default function BottomSheet({ open, onClose, title, children, footer, labelledBy }) {
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);
    const [drag, setDrag] = useState(0);
    // Where the finger let go: the closing slide continues from there.
    const [releaseAt, setReleaseAt] = useState(0);
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef(null);
    const lastMove = useRef({ y: 0, t: 0, v: 0 });
    const headingId = useId();

    useEffect(() => {
        if (open) {
            setMounted(true);
            setClosing(false);
            setDrag(0);
            setReleaseAt(0);
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

    // No page scroll behind an open sheet, and toasts move to the top of the
    // screen so they never sit on the sheet's controls (index.css).
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

    const onTouchStart = (event) => {
        dragStart.current = event.touches[0].clientY;
        lastMove.current = { y: event.touches[0].clientY, t: event.timeStamp, v: 0 };
        setDragging(true);
    };
    const onTouchMove = (event) => {
        if (dragStart.current === null) return;
        const y = event.touches[0].clientY;
        const dy = y - dragStart.current;
        const prev = lastMove.current;
        const dt = event.timeStamp - prev.t;
        if (dt > 0) lastMove.current = { y, t: event.timeStamp, v: (y - prev.y) / dt };
        // Upward pulls give a little and stop (rubber band); downward follows the finger.
        setDrag(dy >= 0 ? dy : -Math.min(12, Math.sqrt(-dy) * 1.5));
    };
    const onTouchEnd = () => {
        const flicked = lastMove.current.v > DISMISS_VELOCITY && drag > FLICK_MIN_PX;
        if (drag > DISMISS_DRAG_PX || flicked) {
            setReleaseAt(Math.max(0, drag));
            onClose?.();
        } else {
            setDrag(0);
        }
        dragStart.current = null;
        setDragging(false);
    };
    const backdropStyle = drag > 0 && !closing
        ? { opacity: Math.max(0.25, 1 - drag / 420), transition: dragging ? 'none' : undefined }
        : undefined;
    let panelStyle;
    if (closing) panelStyle = releaseAt ? { '--sheet-from': `${releaseAt}px` } : undefined;
    else if (drag) panelStyle = { transform: `translateY(${drag}px)`, transition: dragging ? 'none' : undefined };

    return createPortal(
        <div className="fixed inset-0 z-[1100]" data-state={closing ? 'closing' : 'open'}>
            <div
                aria-hidden="true"
                onClick={() => onClose?.()}
                className="sheet-backdrop absolute inset-0 bg-black/60"
                style={backdropStyle}
            />
            <div
                ref={trapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy || (title ? headingId : undefined)}
                className="sheet-panel absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[20px] bg-[var(--ink-2)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)]"
                style={panelStyle}
            >
                <div
                    className="flex justify-center pt-3 pb-2 cursor-grab touch-none"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    aria-hidden="true"
                >
                    <span className="h-1 w-10 rounded-full bg-white/20" />
                </div>
                {title && (
                    <h2 id={headingId} className="px-5 pb-2 text-base font-semibold text-white line-clamp-2">
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
