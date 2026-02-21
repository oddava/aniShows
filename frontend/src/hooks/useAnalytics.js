import { useEffect, useRef, useCallback } from 'react';

/**
 * Simple analytics hook for tracking user interactions
 * In production, this would integrate with Google Analytics, Mixpanel, etc.
 */
export function useAnalytics() {
    const isFirstRender = useRef(true);

    const track = useCallback((event, properties = {}) => {
        // Analytics events are silently tracked - no console output
        // Uncomment below for debugging:
        // if (process.env.NODE_ENV === 'development') {
        //     console.debug('[Analytics]', event, properties);
        // }

        // Send to Google Analytics if available
        if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', event, properties);
        }

        // Send to data layer for GTM
        if (typeof window !== 'undefined' && window.dataLayer) {
            window.dataLayer.push({
                event: event,
                ...properties
            });
        }
    }, []);

    const trackPageView = useCallback((page) => {
        track('page_view', { page });
    }, [track]);

    const trackFilterChange = useCallback((filterType, value) => {
        track('filter_change', { filter_type: filterType, value });
    }, [track]);

    const trackTabChange = useCallback((tab) => {
        track('tab_change', { tab });
    }, [track]);

    const trackViewModeChange = useCallback((mode) => {
        track('view_mode_change', { mode });
    }, [track]);

    const trackSearch = useCallback((query) => {
        track('search', { query });
    }, [track]);

    return {
        track,
        trackPageView,
        trackFilterChange,
        trackTabChange,
        trackViewModeChange,
        trackSearch,
    };
}

/**
 * Hook to track page views
 */
export function usePageView(pageName) {
    const { trackPageView } = useAnalytics();

    useEffect(() => {
        trackPageView(pageName);
    }, [pageName, trackPageView]);
}

export default useAnalytics;
