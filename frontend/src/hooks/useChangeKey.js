import { useState } from 'react';

/**
 * A key that changes each time `value` changes after the first render, plus
 * which way a number moved. Put it on the element as `key` together with a
 * one-shot animation class, so the element replays it on every change and
 * never on first paint.
 *
 *   const { key, changed, direction } = useChangeKey(count);
 *   <span key={key} className={changed ? `count-${direction}` : undefined}>
 */
export default function useChangeKey(value) {
    const [state, setState] = useState({ value, key: 0, direction: 'up' });
    if (!Object.is(state.value, value)) {
        // Adjusting state while rendering (React's "previous value" pattern).
        const before = Number(state.value);
        const after = Number(value);
        const direction = Number.isFinite(before) && Number.isFinite(after) && after < before ? 'down' : 'up';
        const next = { value, key: state.key + 1, direction };
        setState(next);
        return { key: next.key, changed: true, direction };
    }
    return { key: state.key, changed: state.key > 0, direction: state.direction };
}
