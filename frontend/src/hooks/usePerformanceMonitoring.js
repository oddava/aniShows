import { useEffect, useRef } from 'react';

/**
 * Hook to track Core Web Vitals and other performance metrics
 * Silent in development - only logs actual performance issues
 */
export function usePerformanceMonitoring(componentName) {
    const renderCount = useRef(0);

    // Track render count silently
    useEffect(() => {
        renderCount.current += 1;
    });

    // Track Core Web Vitals silently
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!('PerformanceObserver' in window)) return;

        try {
            // Only observe supported entry types
            const supportedTypes = PerformanceObserver.supportedEntryTypes || [];
            
            // Track Largest Contentful Paint (LCP)
            if (supportedTypes.includes('largest-contentful-paint')) {
                const lcpObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    const lastEntry = entries[entries.length - 1];
                    // Only log if LCP is poor (> 2.5s)
                    if (lastEntry.startTime > 2500) {
                        console.warn(`[Performance] ${componentName} LCP:`, lastEntry.startTime.toFixed(0), 'ms');
                    }
                });
                lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
            }

            // Track First Input Delay (FID)
            if (supportedTypes.includes('first-input')) {
                const fidObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const delay = entry.processingStart - entry.startTime;
                        // Only log if FID is poor (> 100ms)
                        if (delay > 100) {
                            console.warn(`[Performance] ${componentName} FID:`, delay.toFixed(0), 'ms');
                        }
                    }
                });
                fidObserver.observe({ entryTypes: ['first-input'] });
            }

            // Track Cumulative Layout Shift (CLS)
            if (supportedTypes.includes('layout-shift')) {
                let clsValue = 0;
                const clsObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            clsValue += entry.value;
                        }
                    }
                    // Only log if CLS is poor (> 0.1)
                    if (clsValue > 0.1) {
                        console.warn(`[Performance] ${componentName} CLS:`, clsValue.toFixed(3));
                    }
                });
                clsObserver.observe({ entryTypes: ['layout-shift'] });
            }

            // Track long tasks
            if (supportedTypes.includes('longtask')) {
                const longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        // Only log if task is very long (> 200ms)
                        if (entry.duration > 200) {
                            console.warn(`[Performance] ${componentName} Long task:`, entry.duration.toFixed(0), 'ms');
                        }
                    }
                });
                longTaskObserver.observe({ entryTypes: ['longtask'] });
            }
        } catch (error) {
            // Silently fail if PerformanceObserver is not supported
        }
    }, [componentName]);

    return {
        getRenderCount: () => renderCount.current,
    };
}

/**
 * Hook to measure component render time
 * Only logs slow renders (> 50ms)
 */
export function useRenderTime(componentName) {
    const startTime = useRef(performance.now());

    useEffect(() => {
        const endTime = performance.now();
        const renderTime = endTime - startTime.current;
        
        // Only log slow renders
        if (renderTime > 50) {
            console.warn(`[Performance] ${componentName} slow render:`, renderTime.toFixed(2), 'ms');
        }

        // Reset start time for next render
        startTime.current = performance.now();
    });
}

export default usePerformanceMonitoring;
