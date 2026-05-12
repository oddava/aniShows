import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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
