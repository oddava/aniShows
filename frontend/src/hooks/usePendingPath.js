import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HISTORY_EVENT, patchHistory } from '../app/historyEvents';

/**
 * The path being navigated to, from the moment a link is followed.
 *
 * Router navigations run as transitions, so the router's location only moves
 * once the next page has rendered (its code and, often, data loaded). Nav
 * items that read this light up on the tap itself, so the sliding pill starts
 * at once. It is the router's path, overridden by the address bar only while
 * a navigation that started from the current page is still in flight.
 */
export default function usePendingPath() {
    const routerPath = useLocation().pathname;
    const routerPathRef = useRef(routerPath);
    const [pending, setPending] = useState(null);

    useEffect(() => {
        routerPathRef.current = routerPath;
    }, [routerPath]);

    useEffect(() => {
        patchHistory();
        const onChange = () => setPending({ path: window.location.pathname, from: routerPathRef.current });
        window.addEventListener(HISTORY_EVENT, onChange);
        window.addEventListener('popstate', onChange);
        return () => {
            window.removeEventListener(HISTORY_EVENT, onChange);
            window.removeEventListener('popstate', onChange);
        };
    }, []);

    return pending && pending.from === routerPath ? pending.path : routerPath;
}
