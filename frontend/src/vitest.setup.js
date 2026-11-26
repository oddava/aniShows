import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { configure } from '@testing-library/react';

// findBy*/waitFor default to 1 s, which a busy CI box can exceed on a cold
// first render of a lazy page; 3 s still fails fast on real bugs.
configure({ asyncUtilTimeout: 3000 });

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

if (typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'function') {
    class MockIntersectionObserver {
        constructor(callback) {
            this.callback = callback;
        }

        observe = (element) => {
            this.callback([{ isIntersecting: true, target: element }], this);
        };

        unobserve = vi.fn();
        disconnect = vi.fn();
        takeRecords = () => [];
    }

    Object.defineProperty(window, 'IntersectionObserver', {
        writable: true,
        configurable: true,
        value: MockIntersectionObserver,
    });

    Object.defineProperty(globalThis, 'IntersectionObserver', {
        writable: true,
        configurable: true,
        value: MockIntersectionObserver,
    });
}

// Recharts' ResponsiveContainer measures with ResizeObserver, which jsdom lacks.
if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'function') {
    class MockResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
    }

    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        configurable: true,
        value: MockResizeObserver,
    });
}
