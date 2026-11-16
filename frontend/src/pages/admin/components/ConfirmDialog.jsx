import { useCallback, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import { useFocusTrap } from '../../../hooks/useFocusTrap';

const BUTTON = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0';

function ConfirmDialogPanel({
    title,
    message,
    confirmLabel,
    cancelLabel,
    destructive,
    requireText,
    busy,
    confirmDisabled,
    onConfirm,
    onCancel,
    children,
}) {
    const titleId = useId();
    const messageId = useId();
    const inputId = useId();
    const [typed, setTyped] = useState('');
    const containerRef = useFocusTrap(true, busy ? undefined : onCancel);

    const typedOk = !requireText || typed.trim() === requireText;
    const disabled = busy || confirmDisabled || !typedOk;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!disabled) onConfirm();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70">
            <div
                ref={containerRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={message ? messageId : undefined}
                className="w-full max-w-md bg-dark-100 border border-white/10 rounded-2xl"
            >
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
                    {message && (
                        <div id={messageId} className="text-sm text-white/70 space-y-2">{message}</div>
                    )}
                    {children}
                    {requireText && (
                        <div>
                            <label htmlFor={inputId} className="block text-sm text-white/70 mb-1">
                                Type <span className="font-mono text-white">{requireText}</span> to confirm
                            </label>
                            <input
                                id={inputId}
                                type="text"
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                autoComplete="off"
                                className="w-full px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                            />
                        </div>
                    )}
                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            className={`${BUTTON} bg-white/10 text-white hover:bg-white/20`}
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="submit"
                            disabled={disabled}
                            className={`${BUTTON} ${destructive
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                : 'bg-[#7c3aed] text-white hover:bg-violet-700'}`}
                        >
                            {busy ? 'Working…' : confirmLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

ConfirmDialogPanel.propTypes = {
    title: PropTypes.node.isRequired,
    message: PropTypes.node,
    confirmLabel: PropTypes.node,
    cancelLabel: PropTypes.node,
    destructive: PropTypes.bool,
    requireText: PropTypes.string,
    busy: PropTypes.bool,
    confirmDisabled: PropTypes.bool,
    onConfirm: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired,
    children: PropTypes.node,
};

/**
 * Accessible replacement for `window.confirm()`: an `alertdialog` that traps
 * focus, closes on Escape, returns focus to the opener, and can require the
 * admin to type a name before a destructive action.
 */
export default function ConfirmDialog({
    isOpen,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    busy = false,
    confirmDisabled = false,
    ...props
}) {
    if (!isOpen) return null;
    return (
        <ConfirmDialogPanel
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            destructive={destructive}
            busy={busy}
            confirmDisabled={confirmDisabled}
            {...props}
        />
    );
}

ConfirmDialog.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    ...ConfirmDialogPanel.propTypes,
};

/**
 * Promise-based confirm for event handlers:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: 'Delete genre?', destructive: true }))) return;
 *   ...
 *   return <>{...}{confirmDialog}</>;
 */
export function useConfirm() {
    const [options, setOptions] = useState(null);
    const resolver = useRef(null);

    const confirm = useCallback((next) => new Promise((resolve) => {
        resolver.current = resolve;
        setOptions(next);
    }), []);

    const settle = useCallback((value) => {
        resolver.current?.(value);
        resolver.current = null;
        setOptions(null);
    }, []);

    const dialog = (
        <ConfirmDialog
            isOpen={options !== null}
            title=""
            {...options}
            onConfirm={() => settle(true)}
            onCancel={() => settle(false)}
        />
    );

    return [confirm, dialog];
}
