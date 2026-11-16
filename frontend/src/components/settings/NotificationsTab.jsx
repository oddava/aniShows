import NotificationPreferenceMatrix from '../notifications/NotificationPreferenceMatrix';
import PushDeviceCard from '../notifications/PushDeviceCard';
import useWebPush from '../notifications/useWebPush';

/**
 * The Notifications tab: push on this device, then the preferences matrix
 * (category x channel, from the server's schema). `notifications` is the state
 * from useNotificationPreferences.
 */
function NotificationSettings({ notifications }) {
    const push = useWebPush({ userId: notifications.userId });
    const pushAvailable = push.isConfigLoading || push.configEnabled;

    return (
        <div className="space-y-6 animate-fade-in">
            <PushDeviceCard push={push} />
            <NotificationPreferenceMatrix
                schema={notifications.schema}
                preferences={notifications.preferences}
                savingKeys={notifications.savingKeys}
                onToggle={notifications.handleTogglePreference}
                push={{ available: pushAvailable, ready: push.subscribed || push.otherDevices.length > 0 }}
                isLoading={notifications.isLoadingPreferences}
                loadError={notifications.preferencesLoadError}
                onRetry={notifications.retryPreferences}
                statusMessage={notifications.preferencesMessage}
                status={notifications.preferencesStatus}
            />
        </div>
    );
}

export default function NotificationsTab({ notifications }) {
    return <NotificationSettings notifications={notifications} />;
}
