import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const UMAMI_SCRIPT_ID = 'umami-analytics-script';
const scriptUrl = import.meta.env.VITE_UMAMI_SCRIPT_URL;
const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;

const hasUmamiConfig = Boolean(scriptUrl && websiteId);

const UmamiAnalytics = () => {
    const location = useLocation();
    const [isReady, setIsReady] = useState(Boolean(window.umami));

    useEffect(() => {
        if (!hasUmamiConfig) {
            return undefined;
        }

        const existingScript = document.getElementById(UMAMI_SCRIPT_ID);
        if (existingScript) {
            if (window.umami) {
                setIsReady(true);
            } else {
                existingScript.addEventListener('load', () => setIsReady(true), { once: true });
            }
            return undefined;
        }

        const script = document.createElement('script');
        script.id = UMAMI_SCRIPT_ID;
        script.src = scriptUrl;
        script.async = true;
        script.defer = true;
        script.dataset.websiteId = websiteId;
        script.dataset.autoTrack = 'false';
        script.addEventListener('load', () => setIsReady(true), { once: true });

        document.head.appendChild(script);

        return undefined;
    }, []);

    useEffect(() => {
        if (!isReady || !window.umami) {
            return;
        }

        window.umami.track();
    }, [isReady, location.pathname, location.search]);

    return null;
};

export default UmamiAnalytics;
