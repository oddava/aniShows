import { Check, Trash2 } from 'lucide-react';
import { LIST_STATUSES } from '../../utils/listStatus';
import ScorePicker from './ScorePicker';

/**
 * The status choices, shared by the card quick-add, the detail page and the
 * library: five fixed-colour rows, then Remove. Rows are 44 px tall.
 */
export function StatusOptions({ current, onSelect, onRemove, autoFocus = false }) {
    return (
        <div role="menu" className="flex flex-col">
            {LIST_STATUSES.map((status, index) => {
                const isCurrent = current === status.value;
                return (
                    <button
                        key={status.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isCurrent}
                        autoFocus={autoFocus && (isCurrent || (!current && index === 0))}
                        onClick={() => onSelect(status.value)}
                        className={`flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-sm font-medium transition-colors ${isCurrent ? 'bg-white/[0.07] text-white' : 'text-gray-200 hover:bg-white/[0.06] hover:text-white'}`}
                    >
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
                        <span className="flex-1">{status.label}</span>
                        {isCurrent && <Check aria-hidden="true" className="h-4 w-4 text-gray-300" />}
                    </button>
                );
            })}
            {current && onRemove && (
                <>
                    <div aria-hidden="true" className="h-2" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={onRemove}
                        className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-sm font-medium text-[var(--danger)] hover:bg-[rgb(240_100_90/0.1)]"
                    >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        Remove from list
                    </button>
                </>
            )}
        </div>
    );
}

/**
 * Right after "Completed": score it in one tap, or skip (T4). Shown in the
 * same popover/sheet the status was picked in.
 */
export function ScoreStep({ value, onScore, onSkip }) {
    return (
        <div className="px-1 pb-1">
            <p className="px-2 pt-1 pb-3 text-sm text-gray-300">
                <span className="font-semibold text-white">Completed.</span> Score it?
            </p>
            <ScorePicker value={value} onChange={onScore} size="sm" allowClear={false} label="Score this anime" />
            <button
                type="button"
                onClick={onSkip}
                className="mt-2 min-h-11 w-full rounded-[var(--radius-sm)] text-sm font-medium text-gray-400 hover:bg-white/[0.05] hover:text-white"
            >
                Skip
            </button>
        </div>
    );
}
