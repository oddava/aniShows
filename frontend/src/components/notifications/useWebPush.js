import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { notificationApi } from '../../api/modules/notifications';
import { notificationKeys, notificationQueries } from '../../api/queries/notifications';
import logger from '../../utils/logger';
import { disable as disablePush, enable as enablePush, getDeviceState, support as pushSupport } from './pushClient';

const ERROR_COPY = {
    denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.',
    dismissed: 'Push stays off: the browser’s permission prompt was dismissed.',
    'push-disabled': 'Push notifications aren’t available on this server right now.',
    unsupported: 'This browser can’t receive push notifications.',
    'ios-needs-install': 'Add AniShows to your Home Screen to get push notifications.',
};

const errorMessage = (error) => ERROR_COPY[error?.code] || 'Couldn’t change push on this device. Try again.';

/**
 * Web push for Settings: the server's push config, this browser's state and
 * the user's other devices. `subscribed` is true only when this user turned
 * push on here and the browser still has the subscription.
 */
export default function useWebPush({ userId } = {}) {
    const queryClient = useQueryClient();
    const signedIn = userId != null;

    const configQuery = useQuery({
        ...notificationQueries.pushConfig(),
        enabled: signedIn,
        retry: false,
    });
    const configEnabled = Boolean(configQuery.data?.enabled);

    const [device, setDevice] = useState(() => ({
        support: pushSupport(),
        subscribed: false,
        id: null,
        checked: false,
    }));
    const [isBusy, setIsBusy] = useState(false);
    const [message, setMessage] = useState('');

    const refresh = useCallback(async () => {
        try {
            const state = await getDeviceState(userId);
            setDevice({ ...state, checked: true });
        } catch (error) {
            logger.warn('Push: could not read this device', error);
            setDevice((prev) => ({ ...prev, checked: true }));
        }
    }, [userId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const devicesQuery = useQuery({
        ...notificationQueries.devices(userId),
        enabled: signedIn && configEnabled,
        retry: false,
    });

    const refreshDevices = useCallback(
        () => queryClient.invalidateQueries({ queryKey: notificationKeys.devices(userId) }),
        [queryClient, userId],
    );

    const enable = useCallback(async () => {
        setIsBusy(true);
        setMessage('');
        try {
            await enablePush({ publicKey: configQuery.data?.publicKey, userId });
            setMessage('Push is on for this device.');
        } catch (error) {
            logger.warn('Push: enable failed', error);
            setMessage(errorMessage(error));
        } finally {
            await refresh();
            refreshDevices();
            setIsBusy(false);
        }
    }, [configQuery.data?.publicKey, refresh, refreshDevices, userId]);

    const disable = useCallback(async () => {
        setIsBusy(true);
        setMessage('');
        try {
            await disablePush();
            setMessage('Push is off for this device.');
        } catch (error) {
            logger.warn('Push: disable failed', error);
            setMessage('Couldn’t turn push off on the server. Try again.');
        } finally {
            await refresh();
            refreshDevices();
            setIsBusy(false);
        }
    }, [refresh, refreshDevices]);

    const removeMutation = useMutation({
        mutationFn: (id) => notificationApi.deleteSubscription(id),
        onSuccess: (_response, id) => {
            queryClient.setQueryData(notificationKeys.devices(userId), (list) => list?.filter((item) => item.id !== id));
        },
        onError: (error) => {
            logger.warn('Push: could not remove a device', error);
            setMessage('Couldn’t remove that device. Try again.');
        },
    });

    const devices = devicesQuery.data || [];
    const otherDevices = devices.filter((item) => device.id == null || item.id !== device.id);
    // The server is the truth: a row removed elsewhere (or dropped after failures)
    // means this device gets nothing, whatever the browser still holds.
    // While the list is loading, refetching (e.g. right after enabling) or failed,
    // the answer is unknown: keep the browser's view instead of flashing "off".
    const onServer = devicesQuery.data == null || device.id == null
        || devicesQuery.isFetching || devicesQuery.isError
        || devices.some((item) => item.id === device.id);

    return {
        isConfigLoading: signedIn && configQuery.isPending,
        configEnabled,
        configError: Boolean(configQuery.error),
        support: device.support,
        isChecking: !device.checked,
        subscribed: configEnabled && device.subscribed && onServer,
        deviceId: device.id,
        isBusy,
        message,
        enable,
        disable,
        otherDevices,
        isDevicesLoading: devicesQuery.isPending && devicesQuery.fetchStatus !== 'idle',
        removeDevice: removeMutation.mutate,
        removingId: removeMutation.isPending ? removeMutation.variables : null,
    };
}
