import React, { useCallback, useEffect, useState } from 'react';

import AppProviders from './app/providers';
import AppRoutes, { preloadForumChunks } from './app/routes';
import { MAINTENANCE_MODE_EVENT } from './api/httpClient';
import MaintenanceScreen from './components/MaintenanceScreen';

const DEFAULT_MAINTENANCE_MESSAGE =
    'The service is temporarily unavailable due to maintenance. Please try again later.';

function App() {
    const [maintenance, setMaintenance] = useState(() => {
        if (typeof window === 'undefined') {
            return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
        }

        const fromStorage = sessionStorage.getItem('app_maintenance_mode');
        if (fromStorage === 'true') {
            return { enabled: true, message: DEFAULT_MAINTENANCE_MESSAGE };
        }

        return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
    });
    const [checkingStatus, setCheckingStatus] = useState(false);

    const checkServiceHealth = useCallback(async () => {
        setCheckingStatus(true);
        try {
            const response = await fetch('/api/v1/health/', {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
            });
            const payload = await response.json().catch(() => ({}));

            const serviceAvailable = response.ok && payload?.service_available === true;
            if (serviceAvailable) {
                sessionStorage.removeItem('app_maintenance_mode');
                setMaintenance({ enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE });
                return true;
            }

            if (payload?.maintenance_mode === true) {
                setMaintenance((prev) => ({
                    ...prev,
                    enabled: true,
                    message: payload?.detail || prev.message || DEFAULT_MAINTENANCE_MESSAGE,
                }));
            }
        } catch (err) {
            // Ignore transient network errors and keep maintenance screen active.
        } finally {
            setCheckingStatus(false);
        }

        return false;
    }, []);

    useEffect(() => {
        const onMaintenanceEvent = (event) => {
            const detail = event?.detail || {};
            if (detail.enabled) {
                setMaintenance({
                    enabled: true,
                    message: detail.message || DEFAULT_MAINTENANCE_MESSAGE,
                });
                return;
            }
            setMaintenance({ enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE });
        };

        window.addEventListener(MAINTENANCE_MODE_EVENT, onMaintenanceEvent);
        return () => {
            window.removeEventListener(MAINTENANCE_MODE_EVENT, onMaintenanceEvent);
        };
    }, []);

    useEffect(() => {
        checkServiceHealth();
    }, [checkServiceHealth]);

    useEffect(() => {
        if (!maintenance.enabled) return undefined;

        const intervalId = window.setInterval(() => {
            checkServiceHealth();
        }, 30000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [maintenance.enabled, checkServiceHealth]);

    const handleRetry = useCallback(async () => {
        const recovered = await checkServiceHealth();
        if (recovered) {
            window.location.reload();
        }
    }, [checkServiceHealth]);

    if (maintenance.enabled) {
        return (
            <MaintenanceScreen
                message={maintenance.message}
                onRetry={handleRetry}
                checkingStatus={checkingStatus}
            />
        );
    }

    return (
        <AppProviders>
            <AppRoutes />
        </AppProviders>
    );
}

export default App;
export { preloadForumChunks };
