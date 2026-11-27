import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` (default one minute), so
 * countdowns and "out now" states stay true while a page is left open. The
 * clock pauses in a hidden tab and catches up the moment it is shown again.
 */
export default function useNow(intervalMs = 60_000) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        let timer;
        const tick = () => setNow(Date.now());
        const start = () => {
            clearInterval(timer);
            timer = setInterval(tick, intervalMs);
        };
        const onVisibility = () => {
            if (document.hidden) {
                clearInterval(timer);
            } else {
                tick();
                start();
            }
        };

        start();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [intervalMs]);

    return now;
}
