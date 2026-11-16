import NotificationPreferenceMatrix from '../notifications/NotificationPreferenceMatrix';
import PushDeviceCard from '../notifications/PushDeviceCard';
import useWebPush from '../notifications/useWebPush';

// Legacy: remove after C-G1-4.
const EMAIL_NOTIFICATION_OPTIONS = [
    {
        key: 'email_new_episodes',
        label: 'New Episode Alerts',
        description: 'Get an email when a new episode airs for anime in your list.',
    },
];

// Legacy: remove after C-G1-4.
const PUSH_NOTIFICATION_OPTIONS = [
    {
        key: 'push_new_episodes',
        label: 'New Episode Alerts',
        description: 'Send a browser notification when a new episode airs.',
    },
    {
        key: 'push_review_replies',
        label: 'Review Replies',
        description: 'Send a browser notification when someone replies to your reviews.',
    },
    {
        key: 'push_new_follower',
        label: 'New Followers',
        description: 'Send a browser notification when someone follows you.',
    },
];

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
                push={{ available: pushAvailable, ready: push.subscribed }}
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
    // The real hook always returns `schema` (null while loading). Only the
    // legacy flat state, as G1's SettingsTabs test renders it, lacks the key.
    if (notifications && Object.prototype.hasOwnProperty.call(notifications, 'schema')) {
        return <NotificationSettings notifications={notifications} />;
    }
    return <LegacyNotificationsTab notifications={notifications} />;
}

/*
 * The four flat switches the tab had before the preferences matrix.
 * Legacy: remove after C-G1-4 (G1 drops the NotificationsTab block from
 * SettingsTabs.test.jsx, the only thing that still renders this).
 */
function LegacyNotificationsTab({ notifications }) {
    const {
        preferences,
        isLoadingPreferences,
        isSavingPreferences,
        preferencesMessage,
        handleTogglePreference,
    } = notifications;

    const renderNotificationPreference = ({ key, label, description }) => {
        const isEnabled = Boolean(preferences[key]);

        return (
            <div key={key} className="flex items-start justify-between gap-4 py-4">
                <div className="pr-2">
                    <p className="text-sm font-semibold leading-5 text-gray-100 sm:text-[15px]">{label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-400">{description}</p>
                </div>

                <button
                    type="button"
                    role="switch"
                    aria-checked={isEnabled}
                    aria-label={label}
                    onClick={() => handleTogglePreference(key)}
                    disabled={isSavingPreferences}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-100
                    ${isEnabled ? 'border-accent bg-accent-dark' : 'border-gray-700 bg-dark-50'}
                    ${isSavingPreferences ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                    <span
                        className={`h-5 w-5 rounded-full bg-white transition-transform duration-200 ${isEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                </button>
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Success/Error Message */}
            {preferencesMessage && (
                <div className={`p-4 rounded-xl flex items-center gap-3 ${preferencesMessage.includes('success')
                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}>
                    {preferencesMessage.includes('success') ? (
                        <div className="w-5 h-5 border-2 border-green-500 rounded-full flex items-center justify-center text-[10px] font-bold">✓</div>
                    ) : (
                        <div className="w-5 h-5 border-2 border-red-500 rounded-full flex items-center justify-center text-[10px] font-bold">!</div>
                    )}
                    <span className="font-medium">{preferencesMessage}</span>
                </div>
            )}

            {/* Email Notifications */}
            <div className="rounded-2xl border border-gray-800 bg-dark-100 p-5 sm:p-6">
                <div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-100 sm:text-xl">Email Notifications</h2>
                        <p className="mt-1 text-sm text-gray-400">Get notified via email</p>
                    </div>
                </div>

                {isLoadingPreferences ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="mt-5 divide-y divide-gray-800/80">
                        {EMAIL_NOTIFICATION_OPTIONS.map(renderNotificationPreference)}
                    </div>
                )}
            </div>

            {/* Push Notifications */}
            <div className="rounded-2xl border border-gray-800 bg-dark-100 p-5 sm:p-6">
                <div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-100 sm:text-xl">Push Notifications</h2>
                        <p className="mt-1 text-sm text-gray-400">Get notified in your browser</p>
                    </div>
                </div>

                {isLoadingPreferences ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="mt-5 divide-y divide-gray-800/80">
                        {PUSH_NOTIFICATION_OPTIONS.map(renderNotificationPreference)}
                    </div>
                )}
            </div>

            {/* Info Section */}
            <div className="rounded-2xl border border-gray-800/80 bg-dark-100/70 p-5">
                <div>
                    <h3 className="text-sm font-semibold text-gray-100">About Notifications</h3>
                    <p className="mt-2 text-sm leading-relaxed text-gray-400">
                        Notifications help you stay up to date with your anime. You&apos;ll receive alerts for new episodes
                        in your Watching or Plan to Watch lists, plus replies to your reviews.
                    </p>
                </div>
            </div>
        </div>
    );
}
