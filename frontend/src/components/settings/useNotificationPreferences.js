import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { notificationApi } from '../../api/client';
import { notificationKeys, notificationQueries } from '../../api/queries/notifications';
import { useFreshError, useReportError } from '../../hooks/useQueryErrorReport';
import logger from '../../utils/logger';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './settingsUtils';

/**
 * Notification-preference toggles for the Settings page. Loaded once a user is
 * known; mounted with the page so switching tabs does not refetch.
 */
export default function useNotificationPreferences({ user, queryClient }) {
    // Notification preferences: loaded once a user is known; a toggle shows at
    // once (`pendingPreferences`) and falls back to the saved value if the save fails.
    const preferencesQuery = useQuery({
        ...notificationQueries.preferences(user?.id),
        enabled: !!user,
        staleTime: 0,
        retry: false,
    });
    useReportError(
        useFreshError(preferencesQuery, notificationKeys.preferences(user?.id)),
        preferencesQuery.errorUpdatedAt,
        { log: 'Failed to fetch preferences:' },
    );
    const [pendingPreferences, setPendingPreferences] = useState(null);
    const preferences = pendingPreferences ?? preferencesQuery.data ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const isLoadingPreferences = preferencesQuery.isPending
        || (preferencesQuery.isFetching && preferencesQuery.data === undefined);
    const savePreferencesMutation = useMutation({
        mutationFn: (nextPreferences) => notificationApi.updatePreferences(nextPreferences),
        onSuccess: (_response, nextPreferences) => {
            queryClient.setQueryData(notificationKeys.preferences(user?.id), nextPreferences);
        },
        onSettled: () => setPendingPreferences(null),
    });
    const isSavingPreferences = savePreferencesMutation.isPending;
    const [preferencesMessage, setPreferencesMessage] = useState('');

    // Notification preferences handlers
    const handleTogglePreference = async (key) => {
        const newPreferences = {
            ...preferences,
            [key]: !preferences[key],
        };

        setPendingPreferences(newPreferences);

        try {
            await savePreferencesMutation.mutateAsync(newPreferences);
            setPreferencesMessage('Preferences saved successfully');
            setTimeout(() => setPreferencesMessage(''), 3000);
        } catch (error) {
            logger.error('Failed to update preferences:', error);
            // The saved value shows again (onSettled drops the pending one).
            setPreferencesMessage('Failed to save preferences');
            setTimeout(() => setPreferencesMessage(''), 3000);
        }
    };

    return {
        preferences,
        isLoadingPreferences,
        isSavingPreferences,
        preferencesMessage,
        handleTogglePreference,
    };
}
