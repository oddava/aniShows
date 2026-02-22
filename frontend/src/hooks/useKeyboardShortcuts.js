import { useEffect, useCallback } from 'react';

export function useKeyboardShortcuts(shortcuts) {
  const handleKeyDown = useCallback((event) => {
    // Don't trigger shortcuts when typing in input fields
    if (
      event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.isContentEditable
    ) {
      // Allow escape key even in inputs
      if (event.key === 'Escape' && shortcuts.onEscape) {
        shortcuts.onEscape();
        return;
      }
      return;
    }

    const key = event.key.toLowerCase();

    switch (key) {
      case '/':
        event.preventDefault();
        shortcuts.onSearchFocus?.();
        break;
      case 'g':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onGridView?.();
        }
        break;
      case 'l':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onListView?.();
        }
        break;
      case 'm':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onMinimalView?.();
        }
        break;
      case 'f':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onToggleFilters?.();
        }
        break;
      case 'escape':
        shortcuts.onEscape?.();
        break;
      case 'arrowright':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onNextPage?.();
        }
        break;
      case 'arrowleft':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onPrevPage?.();
        }
        break;
      case 'c':
        if (event.shiftKey) {
          event.preventDefault();
          shortcuts.onClearFilters?.();
        }
        break;
      default:
        break;
    }
  }, [shortcuts]);

  useEffect(() => {
    if (!shortcuts.enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, shortcuts.enabled]);
}

export const KEYBOARD_SHORTCUTS_HELP = [
  { key: '/', description: 'Focus search' },
  { key: 'Shift + G', description: 'Grid view' },
  { key: 'Shift + L', description: 'List view' },
  { key: 'Shift + M', description: 'Minimal view' },
  { key: 'Shift + F', description: 'Toggle filters' },
  { key: 'Shift + C', description: 'Clear all filters' },
  { key: 'ESC', description: 'Close modals/filters' }
];