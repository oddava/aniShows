import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import useAdminFocusTrap from '../useFocusTrap';
import Button, { IconButton } from './Button';
import { Field, TextArea, TextInput } from './Inputs';

const EXIT_MS = 140;

/** Keep an overlay mounted for its exit fade; `closing` drives the fade. */
function usePresence(open) {
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);
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
        }, EXIT_MS);
        return () => clearTimeout(timer);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    return { mounted, closing };
}

/**
 * No page scroll behind an open overlay. Nested overlays share one lock: the
 * page's own overflow is saved by the first and restored by the last, in
 * whatever order they close.
 */
let scrollLocks = 0;
let savedOverflow = '';
export function useScrollLock(active) {
    useEffect(() => {
        if (!active) return undefined;
        if (scrollLocks === 0) savedOverflow = document.body.style.overflow;
        scrollLocks += 1;
        document.body.style.overflow = 'hidden';
        document.documentElement.dataset.sheetOpen = 'true';
        return () => {
            scrollLocks = Math.max(0, scrollLocks - 1);
            if (scrollLocks === 0) {
                document.body.style.overflow = savedOverflow;
                delete document.documentElement.dataset.sheetOpen;
            }
        };
    }, [active]);
}

/**
 * The frame both overlays share: portal, backdrop, focus trap (Tab stays
 * inside, Escape closes, focus returns to the opener) and scroll lock.
 */
function OverlayFrame({ open, onClose, labelledBy, describedBy, variant, size, children, dismissible = true }) {
    const { mounted, closing } = usePresence(open);
    const trapRef = useAdminFocusTrap(open, dismissible ? onClose : undefined);
    useScrollLock(open);

    if (!mounted) return null;

    const isDrawer = variant === 'drawer';
    const widths = isDrawer
        ? { md: 'sm:max-w-xl', lg: 'sm:max-w-2xl', xl: 'sm:max-w-3xl' }
        : { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

    return createPortal(
        <div className="fixed inset-0 z-[1000]">
            <div
                aria-hidden="true"
                data-closing={closing}
                className="admin-backdrop absolute inset-0 bg-[rgb(8_10_13/0.68)]"
                onClick={dismissible ? onClose : undefined}
            />
            <div
                className={isDrawer
                    ? 'pointer-events-none absolute inset-0 flex justify-end'
                    : 'pointer-events-none absolute inset-0 flex items-end justify-center sm:items-center sm:p-6'}
            >
                <div
                    ref={trapRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={labelledBy}
                    aria-describedby={describedBy}
                    tabIndex={-1}
                    data-closing={closing}
                    className={isDrawer
                        ? `admin-drawer pointer-events-auto flex h-full w-full flex-col bg-[var(--ink-1)] shadow-[var(--shadow-pop)] outline-none ${widths[size] || widths.md}`
                        : `admin-dialog pointer-events-auto flex max-h-[92dvh] w-full flex-col rounded-t-[var(--radius-lg)] bg-[var(--ink-2)] shadow-[var(--shadow-pop)] outline-none sm:rounded-[var(--radius-lg)] ${widths[size] || widths.md}`}
                >
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function OverlayHeader({ titleId, title, description, descriptionId, onClose, dismissible }) {
    return (
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5 sm:px-6">
            <div className="min-w-0 pt-1.5">
                <h2 id={titleId} className="text-lg font-semibold leading-snug tracking-[-0.01em] text-[var(--text-1)] [overflow-wrap:anywhere]">
                    {title}
                </h2>
                {description && <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">{description}</p>}
            </div>
            {dismissible && <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2 -mt-1" />}
        </div>
    );
}

/**
 * A modal dialog: centred on desktop, a bottom sheet on phones. `footer`
 * holds the actions (right-aligned, stacked full-width on phones).
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }) {
    const titleId = useId();
    const descriptionId = useId();
    return (
        <OverlayFrame
            open={open}
            onClose={onClose}
            labelledBy={titleId}
            describedBy={description ? descriptionId : undefined}
            variant="dialog"
            size={size}
            dismissible={dismissible}
        >
            <OverlayHeader
                titleId={titleId}
                title={title}
                description={description}
                descriptionId={descriptionId}
                onClose={onClose}
                dismissible={dismissible}
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 custom-scrollbar sm:px-6">{children}</div>
            {footer && (
                <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end sm:px-6 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]">
                    {footer}
                </div>
            )}
        </OverlayFrame>
    );
}

/**
 * A side sheet for record details: full height on the right, full screen on
 * phones. The body scrolls; `footer` stays pinned.
 */
export function Drawer({ open, onClose, title, description, children, footer, size = 'md', headerExtra }) {
    const titleId = useId();
    const descriptionId = useId();
    return (
        <OverlayFrame
            open={open}
            onClose={onClose}
            labelledBy={titleId}
            describedBy={description ? descriptionId : undefined}
            variant="drawer"
            size={size}
        >
            <OverlayHeader
                titleId={titleId}
                title={title}
                description={description}
                descriptionId={descriptionId}
                onClose={onClose}
                dismissible
            />
            {headerExtra && <div className="px-5 pb-2 sm:px-6">{headerExtra}</div>}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 custom-scrollbar sm:px-6">{children}</div>
            {footer && (
                <div className="flex flex-wrap justify-end gap-2 bg-[var(--ink-1)] px-5 py-4 shadow-[0_-12px_24px_-16px_rgb(0_0_0/0.6)] sm:px-6 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
                    {footer}
                </div>
            )}
        </OverlayFrame>
    );
}

/**
 * Confirm a consequential action. Optional guards:
 * - `reason`: a required (or optional) note, sent to `onConfirm({ reason })`;
 * - `confirmText`: the admin types this word before the button enables.
 * `busy` shows progress and keeps the dialog open; close it on success.
 *
 *   <ConfirmDialog open={…} onClose={…} title="Suspend Mika?" tone="danger"
 *       reason={{ label: 'Reason', required: true }} confirmLabel="Suspend"
 *       busy={suspend.isPending} onConfirm={({ reason }) => suspend.mutate(…)}>
 *       They are signed out everywhere and cannot sign in until restored.
 *   </ConfirmDialog>
 */
export function ConfirmDialog({
    open,
    onClose,
    onConfirm,
    title,
    children,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'primary',
    reason,
    confirmText,
    busy = false,
    confirmDisabled = false,
    size = 'sm',
}) {
    const [reasonValue, setReasonValue] = useState('');
    const [typed, setTyped] = useState('');

    // Fresh fields each time it opens.
    useEffect(() => {
        if (open) {
            setReasonValue('');
            setTyped('');
        }
    }, [open]);

    const min = reason?.min ?? 3;
    const max = reason?.max ?? 500;
    const trimmed = reasonValue.trim();
    const reasonOk = !reason || (!reason.required && trimmed.length === 0) || (trimmed.length >= min && trimmed.length <= max);
    const typedOk = !confirmText || typed.trim() === confirmText;
    const canConfirm = reasonOk && typedOk && !busy && !confirmDisabled;

    const submit = (event) => {
        event?.preventDefault();
        if (canConfirm) onConfirm?.({ reason: trimmed });
    };

    return (
        <Dialog
            open={open}
            onClose={busy ? () => {} : onClose}
            title={title}
            size={size}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
                    <Button
                        variant={tone === 'danger' ? 'danger-solid' : 'primary'}
                        onClick={submit}
                        disabled={!canConfirm}
                        loading={busy}
                    >
                        {confirmLabel}
                    </Button>
                </>
            )}
        >
            <form onSubmit={submit} className="space-y-4 pb-1">
                {children && <div className="text-sm leading-relaxed text-[var(--text-2)]">{children}</div>}
                {reason && (
                    <Field
                        label={reason.label || 'Reason'}
                        hint={reason.hint || (reason.required ? `${min}–${max} characters. Kept in the audit log.` : 'Optional. Kept in the audit log.')}
                    >
                        {(id, aria) => (
                            <TextArea
                                id={id}
                                {...aria}
                                rows={3}
                                maxLength={max}
                                value={reasonValue}
                                onChange={(event) => setReasonValue(event.target.value)}
                                placeholder={reason.placeholder}
                                autoFocus
                            />
                        )}
                    </Field>
                )}
                {confirmText && (
                    <Field label={<>Type <span className="admin-mono rounded bg-white/[0.08] px-1.5 py-0.5 text-[var(--text-1)]">{confirmText}</span> to confirm</>}>
                        {(id) => (
                            <TextInput
                                id={id}
                                value={typed}
                                onChange={(event) => setTyped(event.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                autoFocus={!reason}
                            />
                        )}
                    </Field>
                )}
            </form>
        </Dialog>
    );
}
