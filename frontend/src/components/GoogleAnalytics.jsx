import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const GA_MEASUREMENT_ID = 'G-F5H6MY8PLZ';

export default function GoogleAnalytics() {
    const location = useLocation();

    useEffect(() => {
        // Initialize GA if not already initialized
        if (!window.gtag) {
            // Inject the script
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
            document.head.appendChild(script);

            // Initialize dataLayer
            window.dataLayer = window.dataLayer || [];
            function gtag() {
                window.dataLayer.push(arguments);
            }
            window.gtag = gtag;
            gtag('js', new Date());

            // Config with manual page view control
            gtag('config', GA_MEASUREMENT_ID, {
                send_page_view: false, // We will manually send page views via the effect below
            });
        }
    }, []);

    useEffect(() => {
        // Send page_view event on location change
        if (window.gtag) {
            window.gtag('event', 'page_view', {
                page_path: location.pathname + location.search,
                page_title: document.title,
            });
        }
    }, [location]);

    return null;
}
