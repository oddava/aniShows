import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useDebouncedValue from '../useDebouncedValue';

describe('useDebouncedValue', () => {
    afterEach(() => vi.useRealTimers());

    it('settles 300ms after the last change', () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
            initialProps: { value: 'a' },
        });
        expect(result.current).toBe('a');

        rerender({ value: 'ab' });
        act(() => vi.advanceTimersByTime(200));
        rerender({ value: 'abc' });
        act(() => vi.advanceTimersByTime(299));
        expect(result.current).toBe('a');

        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe('abc');
    });
});
