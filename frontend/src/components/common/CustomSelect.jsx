import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

function normalizeOption(option) {
    if (option && typeof option === 'object' && 'value' in option) {
        return {
            value: String(option.value),
            label: option.label ?? String(option.value),
            disabled: Boolean(option.disabled),
        };
    }

    return {
        value: String(option ?? ''),
        label: String(option ?? ''),
        disabled: false,
    };
}

export default function CustomSelect({
    id,
    name,
    value,
    defaultValue,
    onChange,
    options = [],
    disabled = false,
    placeholder = 'Select...',
    className = '',
    triggerClassName = '',
    menuClassName = '',
    optionClassName = '',
    startIcon: StartIcon,
    ariaLabel,
}) {
    const generatedId = useId();
    const selectId = id || `custom-select-${generatedId}`;
    const containerRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue ?? '');
    const resolvedOptions = useMemo(() => options.map(normalizeOption), [options]);
    const selectedValue = String(isControlled ? value ?? '' : internalValue ?? '');
    const selectedOption = resolvedOptions.find((option) => option.value === selectedValue);

    useEffect(() => {
        if (!isControlled) {
            setInternalValue(defaultValue ?? '');
        }
    }, [defaultValue, isControlled]);

    useEffect(() => {
        if (!isOpen) return;

        const onPointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };

        const onEscape = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onEscape);

        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onEscape);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const selectedIndex = resolvedOptions.findIndex(
            (option) => option.value === selectedValue && !option.disabled
        );
        const firstEnabledIndex = resolvedOptions.findIndex((option) => !option.disabled);
        const nextIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex;
        setActiveIndex(nextIndex);
    }, [isOpen, resolvedOptions, selectedValue]);

    useEffect(() => {
        if (!isOpen || activeIndex < 0) return;
        const optionNode = menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`);
        if (optionNode && typeof optionNode.scrollIntoView === 'function') {
            optionNode.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, isOpen]);

    const commitValue = (nextValue) => {
        if (!isControlled) {
            setInternalValue(nextValue);
        }
        onChange?.(nextValue);
    };

    const handleSelect = (nextValue) => {
        commitValue(nextValue);
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    const moveActive = (direction) => {
        if (resolvedOptions.length === 0) return;
        let nextIndex = activeIndex;
        let attempts = 0;
        do {
            nextIndex = (nextIndex + direction + resolvedOptions.length) % resolvedOptions.length;
            attempts += 1;
        } while (resolvedOptions[nextIndex]?.disabled && attempts <= resolvedOptions.length);

        if (!resolvedOptions[nextIndex]?.disabled) {
            setActiveIndex(nextIndex);
        }
    };

    const handleTriggerKeyDown = (event) => {
        if (disabled) return;

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
                return;
            }
            moveActive(event.key === 'ArrowDown' ? 1 : -1);
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
                return;
            }
            if (activeIndex >= 0 && !resolvedOptions[activeIndex]?.disabled) {
                handleSelect(resolvedOptions[activeIndex].value);
            }
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            const firstEnabledIndex = resolvedOptions.findIndex((option) => !option.disabled);
            if (firstEnabledIndex >= 0) setActiveIndex(firstEnabledIndex);
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            const reversedIndex = [...resolvedOptions].reverse().findIndex((option) => !option.disabled);
            if (reversedIndex >= 0) {
                setActiveIndex(resolvedOptions.length - 1 - reversedIndex);
            }
        }
    };

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            {name ? <input type="hidden" name={name} value={selectedValue} disabled={disabled} /> : null}

            <button
                ref={triggerRef}
                id={selectId}
                type="button"
                disabled={disabled}
                aria-label={ariaLabel}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                className={`inline-flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-dark-200 px-4 py-3 text-sm font-semibold text-white outline-none transition-colors hover:border-white/20 focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60 ${triggerClassName}`}
                onClick={() => setIsOpen((current) => !current)}
                onKeyDown={handleTriggerKeyDown}
            >
                <span className="flex min-w-0 items-center gap-3">
                    {StartIcon ? <StartIcon className="h-4 w-4 shrink-0 text-gray-500" /> : null}
                    <span className={`truncate ${selectedOption ? 'text-white' : 'text-gray-500'}`}>
                        {selectedOption?.label || placeholder}
                    </span>
                </span>
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen ? (
                <div
                    ref={menuRef}
                    role="listbox"
                    aria-labelledby={selectId}
                    className={`absolute left-0 right-0 z-[260] mt-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-dark-100/95 p-1 shadow-2xl backdrop-blur-xl ${menuClassName}`}
                >
                    {resolvedOptions.map((option, index) => {
                        const isSelected = option.value === selectedValue;
                        const isActive = index === activeIndex;
                        return (
                            <button
                                key={`${option.value}-${index}`}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                data-option-index={index}
                                disabled={option.disabled}
                                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                    option.disabled
                                        ? 'cursor-not-allowed text-gray-600'
                                        : isSelected
                                          ? 'bg-accent/20 text-white'
                                          : isActive
                                            ? 'bg-white/10 text-gray-100'
                                            : 'text-gray-300 hover:bg-white/10 hover:text-white'
                                } ${optionClassName}`}
                                onMouseEnter={() => setActiveIndex(index)}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    if (!option.disabled) handleSelect(option.value);
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
