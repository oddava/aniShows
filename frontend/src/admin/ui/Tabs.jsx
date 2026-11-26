import { useId, useRef } from 'react';

import { formatCompact } from '../format';

/**
 * Soft-fill tabs, as on My list and Settings: the active tab sits on a light
 * fill, no underline. A WAI-ARIA tablist with a roving tabIndex (arrows,
 * Home, End). Items: `{ value, label, count?, dot? }`.
 *
 * Give the content below `role="tabpanel"` and `id={panelId}`, and pass the
 * same `panelId` here so the active tab points at it.
 */
export default function Tabs({ items, value, onChange, label, className = '', size = 'md', panelId }) {
    const refs = useRef({});
    const groupId = useId();

    const move = (event) => {
        const index = items.findIndex((item) => item.value === value);
        const last = items.length - 1;
        const next = {
            ArrowRight: index >= last ? 0 : index + 1,
            ArrowLeft: index <= 0 ? last : index - 1,
            Home: 0,
            End: last,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const target = items[next];
        onChange(target.value);
        refs.current[target.value]?.focus();
    };

    const height = size === 'sm' ? 'min-h-10 px-3 text-sm' : 'min-h-11 px-3.5 text-[0.9375rem]';

    return (
        <div
            role="tablist"
            aria-label={label}
            onKeyDown={move}
            className={`-mx-4 flex gap-1 overflow-x-auto whitespace-nowrap px-4 scrollbar-hide touch-pan-x sm:mx-0 sm:px-0 ${className}`}
        >
            {items.map((item) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        ref={(node) => { refs.current[item.value] = node; }}
                        id={`${groupId}-${item.value}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={active && panelId ? panelId : undefined}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(item.value)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-lg font-medium transition-colors duration-150 ${height}
                        ${active
                            ? 'bg-white/[0.07] text-[var(--text-1)]'
                            : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`}
                    >
                        {item.dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: item.dot }} />}
                        {item.label}
                        {item.count !== undefined && item.count !== null && (
                            <span className={`tabular text-xs ${active ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}`}>
                                {formatCompact(item.count)}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
