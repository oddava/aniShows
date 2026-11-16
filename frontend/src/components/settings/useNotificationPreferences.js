import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { notificationApi } from '../../api/modules/notifications';
import { notificationKeys, notificationQueries } from '../../api/queries/notifications';
import { useFreshError, useReportError } from '../../hooks/useQueryErrorReport';
import logger from '../../utils/logger';

const MESSAGE_MS = 4000;
const EMPTY = {};

const pendingId = (categoryKey, channelKey) => `${categoryKey}.${channelKey}`;

/** Server preferences with the in-flight toggles laid over them. */
const withPending = (preferences, pending) => {
    const ids = Object.keys(pending);
    if (ids.length === 0) return preferences;
    const next = { ...preferences };
    ids.forEach((id) => {
        const [categoryKey, channelKey] = id.split('.');
        next[categoryKey] = { ...(next[categoryKey] || {}), [channelKey]: pending[id] };
    });
    return next;
};

/**
 * Notification preferences for the Settings page: `{category: {channel: bool}}`
 * plus the server's `schema` (which categories and channels exist, which are
 * locked). Each toggle shows at once, is saved on its own with a PATCH, and
 * falls back to the saved value if that fails. Loaded once a user is known;
 * mounted with the page so switching tabs does not refetch.
 */
export default function useNotificationPreferences({ user, queryClient }) {
    const userId = user?.id;
    const preferencesKey = notificationKeys.preferences(userId);
    const preferencesQuery = useQuery({
        ...notificationQueries.preferences(userId),
        enabled: !!user,
        staleTime: 0,
        retry: false,
    });
    const loadError = useFreshError(preferencesQuery, preferencesKey);
    useReportError(loadError, preferencesQuery.errorUpdatedAt, { log: 'Failed to fetch preferences:' });

    const data = preferencesQuery.data;
    const schema = data?.schema ?? null;
    const [pending, setPending] = useState(EMPTY);
    const pendingRef = useRef(pending);
    pendingRef.current = pending;
    const preferences = withPending(data?.preferences ?? EMPTY, pending);
    const isLoadingPreferences = preferencesQuery.isPending
        || (preferencesQuery.isFetching && data === undefined);

    // Save status for the live region: `status` is 'saved' | 'error' | ''.
    const [message, setMessage] = useState({ status: '', text: '' });
    const messageTimer = useRef(null);
    useEffect(() => () => clearTimeout(messageTimer.current), []);
    const showMessage = useCallback((status, text) => {
        clearTimeout(messageTimer.current);
        setMessage({ status, text });
        messageTimer.current = setTimeout(() => setMessage({ status: '', text: '' }), MESSAGE_MS);
    }, []);

    const handleTogglePreference = useCallback(async (categoryKey, channelKey) => {
        const category = schema?.categories?.find((item) => item.key === categoryKey);
        if (!category || !category.channels?.includes(channelKey)) return;
        if (category.locked?.includes(channelKey)) return;

        const id = pendingId(categoryKey, channelKey);
        if (id in pendingRef.current) return;
        const current = withPending(data?.preferences ?? EMPTY, pendingRef.current);
        const nextValue = !current?.[categoryKey]?.[channelKey];

        setPending((prev) => ({ ...prev, [id]: nextValue }));
        try {
            const response = await notificationApi.updatePreferences({ [categoryKey]: { [channelKey]: nextValue } });
            queryClient.setQueryData(preferencesKey, (old) => {
                if (response?.data?.preferences && response?.data?.schema) return response.data;
                if (!old) return old;
                const nextPreferences = {
                    ...old.preferences,
                    [categoryKey]: { ...(old.preferences?.[categoryKey] || {}), [channelKey]: nextValue },
                };
                return { ...old, preferences: nextPreferences };
            });
            showMessage('saved', 'Saved.');
        } catch (error) {
            logger.error('Failed to update preferences:', error);
            showMessage('error', 'Couldn’t save that change, so it was undone. Try again.');
        } finally {
            setPending((prev) => {
                const next = { ...prev };
                delete next[id];
                return Object.keys(next).length ? next : EMPTY;
            });
        }
    }, [data, preferencesKey, queryClient, schema, showMessage]);

    return {
        userId,
        preferences,
        schema,
        isLoadingPreferences,
        isSavingPreferences: Object.keys(pending).length > 0,
        /** `{'category.channel': true}` for each toggle still saving. */
        savingKeys: pending,
        preferencesMessage: message.text,
        preferencesStatus: message.status,
        preferencesLoadError: Boolean(loadError),
        retryPreferences: preferencesQuery.refetch,
        handleTogglePreference,
    };
}
