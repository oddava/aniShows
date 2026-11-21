import { useEffect, useId, useRef, useState } from 'react';
import usePresence from '../../hooks/usePresence';
import PropTypes from 'prop-types';
import { Check, ChevronDown } from 'lucide-react';

/**
 * One compact Browse filter: a soft button ("Format", or the chosen value)
 * that opens a short list. Single choice closes on pick and offers "Any";
 * multiple choice (genres) stays open and offers "Clear". Escape or a click
 * outside closes it.
 */
export default function FilterMenu({
    label,
    options,
    value,
    onChange,
    multiple = false,
    columns = 1,
    anyLabel,
}) {
    const [open, setOpen] = useState(false);
    const panel = usePresence(open, 120);
    const ref = useRef(null);
    const buttonRef = useRef(null);
    const panelId = useId();
    const selected = multiple ? (value || []) : (value ? [String(value)] : []);
    const isActive = selected.length > 0;

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
            if (!ref.current?.contains(event.target)) setOpen(false);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const labelFor = (optionValue) => options.find((option) => String(option.value) === String(optionValue))?.label;
    const triggerText = !isActive
        ? label
        : multiple
            ? (selected.length === 1 ? labelFor(selected[0]) || label : `${label} · ${selected.length}`)
            : labelFor(selected[0]) || label;

    const pick = (optionValue) => {
        const key = String(optionValue);
        if (multiple) {
            onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
            return;
        }
        onChange(selected[0] === key ? '' : key);
        setOpen(false);
    };

    const row = 'flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 hover:bg-white/[0.06]';

    return (
        <div ref={ref} className="relative">
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                aria-label={isActive ? `${label}: ${triggerText}` : label}
                className={`flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors duration-150 ${isActive
                    ? 'bg-[var(--signature-soft)] font-medium text-[var(--signature)]'
                    : 'bg-white/[0.05] text-[var(--text-2)] hover:bg-white/[0.08] hover:text-[var(--text-1)]'}`}
            >
                {triggerText}
                <ChevronDown aria-hidden="true" className={`h-4 w-4 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>

            {panel.mounted && (
                <div
                    id={panelId}
                    data-state={panel.closing ? 'closing' : 'open'}
                    role="group"
                    aria-label={label}
                    className={`popover-in absolute left-0 top-full z-40 mt-2 rounded-xl bg-[var(--ink-3)] p-1.5 shadow-[var(--shadow-pop)] ${columns > 1 ? 'w-[26rem]' : 'min-w-48'}`}
                >
                    <div className={`max-h-80 overflow-y-auto ${columns > 1 ? 'grid grid-cols-2 gap-0.5' : ''}`}>
                        {!multiple && (
                            <button type="button" onClick={() => { onChange(''); setOpen(false); }} aria-pressed={!isActive} className={`${row} ${columns > 1 ? 'col-span-2' : ''} ${!isActive ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
                                {anyLabel || `Any ${label.toLowerCase()}`}
                                {!isActive && <Check aria-hidden="true" className="h-4 w-4 text-[var(--signature)]" />}
                            </button>
                        )}
                        {options.map((option) => {
                            const on = selected.includes(String(option.value));
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => pick(option.value)}
                                    aria-pressed={on}
                                    className={`${row} ${on ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}
                                >
                                    <span className="truncate">{option.label}</span>
                                    {on && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--signature)]" />}
                                </button>
                            );
                        })}
                    </div>
                    {multiple && isActive && (
                        <div className="mt-1 flex justify-end px-1.5 pb-0.5">
                            <button type="button" onClick={() => onChange([])} className="text-link text-sm">
                                Clear
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

FilterMenu.propTypes = {
    label: PropTypes.string.isRequired,
    options: PropTypes.arrayOf(PropTypes.shape({
        value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        label: PropTypes.string.isRequired,
    })).isRequired,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.arrayOf(PropTypes.string)]),
    onChange: PropTypes.func.isRequired,
    multiple: PropTypes.bool,
    columns: PropTypes.number,
    anyLabel: PropTypes.string,
};
