import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';

import { IconButton } from './Button';

const MENU_WIDTH = 248;
const GAP = 6;

/**
 * A row's "more actions" menu (menu button pattern): opens on click, arrows
 * move, Enter/Space choose, Escape or a click outside closes and returns
 * focus to the button. It is portalled and fixed, so table overflow never
 * clips it, and opens upwards when there is no room below.
 *
 * Items: `{ label, onSelect, to, icon, tone: 'danger', disabled, hidden }`
 * (`'divider'` adds space between groups).
 */
export default function Menu({ items, label = 'More actions', icon = MoreHorizontal, size = 'md', align = 'end' }) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const buttonRef = useRef(null);
    const menuRef = useRef(null);
    const itemRefs = useRef([]);
    const menuId = useId();
    const navigate = useNavigate();

    const visible = items.filter((item) => item === 'divider' || (item && !item.hidden));
    const actionable = visible.filter((item) => item !== 'divider');

    const close = useCallback((restoreFocus = true) => {
        setOpen(false);
        if (restoreFocus) buttonRef.current?.focus();
    }, []);

    useLayoutEffect(() => {
        if (!open || !buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const height = menuRef.current?.offsetHeight || 0;
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow < height + GAP + 8 && rect.top > height + GAP
            ? rect.top - height - GAP
            : rect.bottom + GAP;
        const left = align === 'end'
            ? Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
            : Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
        setPosition({ top, left });
    }, [open, align]);

    useEffect(() => {
        if (!open) return undefined;
        const firstEnabled = actionable.findIndex((item) => !item.disabled);
        itemRefs.current[firstEnabled]?.focus();
        const onPointer = (event) => {
            if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close(false);
        };
        const onScroll = () => close(false);
        document.addEventListener('pointerdown', onPointer);
        window.addEventListener('resize', onScroll);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            window.removeEventListener('resize', onScroll);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    if (actionable.length === 0) return null;

    const choose = (item) => {
        if (item.disabled) return;
        close();
        if (item.to) navigate(item.to);
        else item.onSelect?.();
    };

    const onKeyDown = (event) => {
        const enabled = actionable.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);
        const current = itemRefs.current.indexOf(document.activeElement);
        const at = enabled.indexOf(current);
        let next;
        if (event.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length];
        else if (event.key === 'ArrowUp') next = enabled[(at - 1 + enabled.length) % enabled.length];
        else if (event.key === 'Home') next = enabled[0];
        else if (event.key === 'End') next = enabled[enabled.length - 1];
        else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        } else if (event.key === 'Tab') {
            // Tab leaves the menu: it closes and focus is back on its trigger,
            // so inside a dialog focus never escapes to the end of the page.
            event.preventDefault();
            close(true);
            return;
        }
        if (next !== undefined) {
            event.preventDefault();
            itemRefs.current[next]?.focus();
        }
    };

    let actionIndex = -1;

    return (
        <>
            <IconButton
                ref={buttonRef}
                icon={icon}
                label={label}
                size={size}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' && !open) {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            />
            {open && createPortal(
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                    onClick={(event) => event.stopPropagation()}
                    style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: MENU_WIDTH }}
                    className="admin-popover fixed z-[1100] rounded-[var(--radius-md)] bg-[var(--ink-3)] p-1.5 shadow-[var(--shadow-pop)]"
                >
                    {visible.map((item, index) => {
                        if (item === 'divider') {
                            return <div key={`divider-${index}`} role="separator" className="my-1 h-px" />;
                        }
                        actionIndex += 1;
                        const refIndex = actionIndex;
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.label}
                                ref={(node) => { itemRefs.current[refIndex] = node; }}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                aria-disabled={item.disabled || undefined}
                                onClick={() => choose(item)}
                                title={item.disabled && item.disabledReason ? item.disabledReason : undefined}
                                className={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-medium outline-none transition-colors
                                ${item.disabled ? 'cursor-not-allowed opacity-45' : ''}
                                ${item.tone === 'danger'
                                    ? 'text-[var(--danger)] hover:bg-[var(--danger-soft)] focus-visible:bg-[var(--danger-soft)]'
                                    : 'text-[var(--text-1)] hover:bg-white/[0.07] focus-visible:bg-white/[0.07]'}`}
                            >
                                {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />}
                                <span className="min-w-0 py-1.5 leading-snug">{item.label}</span>
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </>
    );
}
