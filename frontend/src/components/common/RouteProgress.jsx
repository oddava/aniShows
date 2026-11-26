import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { installLinkPrefetch, prefetchCommonRoutes } from '../../app/routePrefetch';
import { HISTORY_EVENT, patchHistory } from '../../app/historyEvents';

const SHOW_AFTER_MS = 150;

const currentAddress = () => window.location.pathname + window.location.search;

/**
 * A thin accent bar along the top edge while a page change takes longer than
 * 150 ms (its code still loading), so a click never feels dead. Fast
 * navigations show nothing. It also warms page code ahead of clicks.
 */
export default function RouteProgress() {
    const location = useLocation();
    const rendered = location.pathname + location.search;
    const renderedRef = useRef(rendered);
    const [phase, setPhase] = useState('idle'); // idle | loading | done

    useEffect(() => {
        renderedRef.current = rendered;
        setPhase((current) => (current === 'loading' ? 'done' : current));
    }, [rendered]);

    useEffect(() => {
        if (phase !== 'done') return undefined;
        const timer = setTimeout(() => setPhase('idle'), 340);
        return () => clearTimeout(timer);
    }, [phase]);

    useEffect(() => {
        patchHistory();
        let timer = null;
        const onHistory = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (currentAddress() !== renderedRef.current) setPhase('loading');
            }, SHOW_AFTER_MS);
        };
        window.addEventListener(HISTORY_EVENT, onHistory);
        window.addEventListener('popstate', onHistory);
        const removePrefetch = installLinkPrefetch();
        prefetchCommonRoutes();
        return () => {
            clearTimeout(timer);
            window.removeEventListener(HISTORY_EVENT, onHistory);
            window.removeEventListener('popstate', onHistory);
            removePrefetch();
        };
    }, []);

    if (phase === 'idle') return null;
    return (
        <div aria-hidden="true" className="route-progress" data-phase={phase}>
            <div className="route-progress-bar" />
        </div>
    );
}
