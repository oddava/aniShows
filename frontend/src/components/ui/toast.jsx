import toast from 'react-hot-toast';
import { Check, CircleAlert } from 'lucide-react';

const DURATION_MS = 5000;

/**
 * The one toast: a short line, an optional Undo, the same look for every
 * change on the site. Rendered through react-hot-toast (already a dependency)
 * so there is still a single <Toaster>.
 */
function ToastCard({ t, message, tone, onUndo, undoLabel }) {
    const Icon = tone === 'error' ? CircleAlert : Check;
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            aria-live={tone === 'error' ? 'assertive' : 'polite'}
            data-visible={t.visible ? 'true' : 'false'}
            className="ui-toast pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-[var(--radius-md)] bg-[var(--ink-3)] py-2 pl-3.5 pr-2 text-sm text-gray-100 shadow-[var(--shadow-pop)]"
        >
            <Icon
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 ${tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--signature)]'}`}
            />
            <span className="min-w-0 py-1.5 leading-snug">{message}</span>
            {onUndo ? (
                <button
                    type="button"
                    onClick={() => {
                        toast.dismiss(t.id);
                        onUndo();
                    }}
                    className="ml-1 min-h-9 shrink-0 rounded-md px-3 font-semibold text-[var(--signature)] hover:bg-white/[0.06]"
                >
                    {undoLabel}
                </button>
            ) : (
                <span className="w-1.5" aria-hidden="true" />
            )}
        </div>
    );
}

/**
 * Show a toast. `id` replaces an earlier toast with the same id instead of
 * stacking (e.g. one per anime), `onUndo` adds the Undo button.
 */
export function notify(message, { id, onUndo, undoLabel = 'Undo', tone = 'success', duration = DURATION_MS } = {}) {
    return toast.custom(
        (t) => <ToastCard t={t} message={message} tone={tone} onUndo={onUndo} undoLabel={undoLabel} />,
        { id, duration },
    );
}

export function notifyError(message, options = {}) {
    return notify(message, { ...options, tone: 'error' });
}

export default notify;
