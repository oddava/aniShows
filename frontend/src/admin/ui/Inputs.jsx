import { forwardRef, useEffect, useId, useRef } from 'react';
import { Search, X } from 'lucide-react';

import SettingsSwitch from '../../components/settings/SettingsSwitch';

/**
 * A labelled form control. Pass the control as children; its id comes from
 * `htmlFor` (or a generated one handed to a render function).
 *
 *   <Field label="Name" error={errors.name}>{(id) => <TextInput id={id} … />}</Field>
 */
export function Field({ label, hint, error, htmlFor, required, children, className = '' }) {
    const generated = useId();
    const id = htmlFor || generated;
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const control = typeof children === 'function'
        ? children(id, { 'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })
        : children;
    return (
        <div className={className}>
            {label && (
                <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">
                    {label}
                    {required && <span className="ml-0.5 text-[var(--text-3)]" aria-hidden="true">*</span>}
                </label>
            )}
            {control}
            {hint && !error && <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-[var(--text-3)]">{hint}</p>}
            {error && <p id={errorId} className="mt-1.5 text-xs font-medium text-[var(--danger)]">{error}</p>}
        </div>
    );
}

export const TextInput = forwardRef(function TextInput({ className = '', type = 'text', ...rest }, ref) {
    return <input ref={ref} type={type} className={`admin-input ${className}`} {...rest} />;
});

export const TextArea = forwardRef(function TextArea({ className = '', rows = 4, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={`admin-input ${className}`} {...rest} />;
});

/**
 * A native select in the site's soft style (the OS list is dark through
 * color-scheme). `options` are `{ value, label }` or strings.
 */
export const Select = forwardRef(function Select({ options = [], className = '', label, value, onChange, ...rest }, ref) {
    return (
        <select
            ref={ref}
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => onChange?.(event.target.value, event)}
            className={`admin-input admin-select ${className}`}
            {...rest}
        >
            {options.map((option) => {
                const item = typeof option === 'object' ? option : { value: option, label: option };
                return <option key={String(item.value)} value={item.value} disabled={item.disabled}>{item.label}</option>;
            })}
        </select>
    );
});

/**
 * A filter select for toolbars: compact width, the label is the accessible
 * name and the first ("any") option.
 */
export function FilterSelect({ label, value, onChange, options, allLabel, className = '', ...rest }) {
    return (
        <Select
            {...rest}
            label={label}
            value={value}
            onChange={onChange}
            className={`!w-auto min-w-[9.5rem] max-w-full flex-1 sm:flex-none ${className}`}
            options={[{ value: '', label: allLabel || `All ${label.toLowerCase()}` }, ...options]}
        />
    );
}

/** The list search box: soft fill, search icon, a clear button once there is text. */
export function SearchInput({ value, onChange, placeholder = 'Search', label, className = '', autoFocus = false }) {
    const ref = useRef(null);
    return (
        <div className={`relative min-w-0 flex-1 basis-60 ${className}`}>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" aria-hidden="true" />
            <input
                ref={ref}
                type="search"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                aria-label={label || placeholder}
                autoFocus={autoFocus}
                className="admin-input !pl-10 !pr-10 [&::-webkit-search-cancel-button]:hidden"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => {
                        onChange('');
                        ref.current?.focus();
                    }}
                    className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-3)] hover:text-[var(--text-1)]"
                    aria-label="Clear search"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            )}
        </div>
    );
}

/** The site's on/off switch. */
export function Switch({ checked, onChange, label, disabled, describedBy }) {
    return (
        <SettingsSwitch
            checked={Boolean(checked)}
            onClick={() => onChange?.(!checked)}
            disabled={disabled}
            label={label}
            describedBy={describedBy}
        />
    );
}

/** A setting row: title and explanation on the left, the switch on the right. */
export function SwitchRow({ label, description, checked, onChange, disabled }) {
    const id = useId();
    return (
        <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
                <p id={`${id}-label`} className="text-sm font-medium text-[var(--text-1)]">{label}</p>
                {description && <p id={`${id}-desc`} className="mt-0.5 text-sm leading-relaxed text-[var(--text-2)]">{description}</p>}
            </div>
            <div className="pt-0.5">
                <SettingsSwitch
                    checked={Boolean(checked)}
                    onClick={() => onChange?.(!checked)}
                    disabled={disabled}
                    labelledBy={`${id}-label`}
                    describedBy={description ? `${id}-desc` : undefined}
                />
            </div>
        </div>
    );
}

/** A styled checkbox. `indeterminate` is set on the DOM node. */
export function Checkbox({ checked, indeterminate = false, onChange, label, className = '', ...rest }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
    }, [indeterminate, checked]);
    return (
        <input
            ref={ref}
            type="checkbox"
            checked={Boolean(checked)}
            onChange={(event) => onChange?.(event.target.checked, event)}
            aria-label={label}
            className={`admin-check ${className}`}
            {...rest}
        />
    );
}

/** A checkbox with a visible label, 44 px tall. */
export function CheckboxRow({ checked, onChange, label, description, disabled }) {
    const id = useId();
    return (
        <label htmlFor={id} className={`flex min-h-11 items-start gap-3 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
            <Checkbox id={id} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
            <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--text-1)]">{label}</span>
                {description && <span className="mt-0.5 block text-sm text-[var(--text-2)]">{description}</span>}
            </span>
        </label>
    );
}

/**
 * A removable filter chip, "User: kaito ×", for filters that arrive by link
 * (an id in the URL) rather than from a toolbar control.
 */
export function FilterChip({ label, onRemove }) {
    return (
        <span className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-[var(--signature-soft)] pl-3 pr-1 text-sm font-medium text-[var(--signature)]">
            {label}
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove filter ${typeof label === 'string' ? label : ''}`.trim()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/[0.06] relative after:absolute after:-inset-1.5 after:content-['']"
            >
                <X className="h-4 w-4" aria-hidden="true" />
            </button>
        </span>
    );
}

/**
 * A "Sort by" menu's options, plus the current ordering when it came from a
 * column header and is not one of them, so the menu never shows the wrong sort.
 */
export function withCurrentSort(options, value, label = 'Column order') {
    if (!value || options.some((option) => option.value === value)) return options;
    const descending = value.startsWith('-');
    const name = value.replace(/^-/, '').replace(/_/g, ' ');
    return [{ value, label: `${label}: ${name}${descending ? ', descending' : ''}` }, ...options];
}
