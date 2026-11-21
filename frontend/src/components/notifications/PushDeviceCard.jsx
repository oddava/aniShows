import { Loader2 } from 'lucide-react';

import { formatRelativeTime } from './notificationDisplay';

const deviceName = (device) => device?.device_info?.label || 'Unknown device';

function DeviceStatus({ push }) {
    if (push.isChecking) {
        return <p className="text-sm text-gray-400">Checking this device…</p>;
    }
    if (push.support === 'ios-needs-install') {
        return (
            <p className="text-sm leading-relaxed text-gray-400">
                Add AniShows to your Home Screen to get push notifications. Then open it from the Home Screen
                and turn push on here.
            </p>
        );
    }
    if (push.support === 'unsupported') {
        return <p className="text-sm leading-relaxed text-gray-400">This browser can’t receive push notifications.</p>;
    }
    if (push.support === 'denied') {
        return (
            <p className="text-sm leading-relaxed text-gray-400">
                Notifications are blocked for this site. Allow them in your browser’s site settings, then come back
                here to turn push on.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-gray-400">
                {push.subscribed
                    ? 'Push is on for this device.'
                    : 'Get alerts on this device, even when AniShows is closed.'}
            </p>
            {push.subscribed ? (
                <button type="button" onClick={push.disable} disabled={push.isBusy} className="btn-secondary text-sm shrink-0">
                    {push.isBusy && <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />}
                    Turn off on this device
                </button>
            ) : (
                <button type="button" onClick={push.enable} disabled={push.isBusy} className="btn-primary text-sm shrink-0">
                    {push.isBusy && <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />}
                    Turn on for this device
                </button>
            )}
        </div>
    );
}

/**
 * Push on this device (on/off, with honest copy when the browser can't do it)
 * and the user's other devices, each removable. `push` is the useWebPush state.
 */
export default function PushDeviceCard({ push }) {
    return (
        <div className="rounded-2xl border border-gray-800 bg-dark-100 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-100 sm:text-xl">Push on this device</h2>

            {push.isConfigLoading ? (
                <p className="mt-3 text-sm text-gray-400">Checking push support…</p>
            ) : !push.configEnabled ? (
                <p className="mt-3 text-sm leading-relaxed text-gray-400">
                    Push notifications aren’t available right now, so alerts arrive in the app
                    {' '}(and by email, where you’ve turned that on).
                </p>
            ) : (
                <>
                    <div className="mt-3">
                        <DeviceStatus push={push} />
                    </div>

                    {push.otherDevices.length > 0 && (
                        <div className="mt-5 pt-4">
                            <h3 className="text-sm font-semibold text-gray-100">Other devices</h3>
                            <ul className="mt-2 ">
                                {push.otherDevices.map((device) => (
                                    <li key={device.id} className="flex items-center justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-gray-100">{deviceName(device)}</p>
                                            {(device.last_used || device.created_at) && (
                                                <p className="text-xs text-gray-500">
                                                    {device.last_used ? 'Last used ' : 'Added '}
                                                    {formatRelativeTime(device.last_used || device.created_at)}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => push.removeDevice(device.id)}
                                            disabled={push.removingId === device.id}
                                            aria-label={`Remove ${deviceName(device)}`}
                                            className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                                        >
                                            Remove
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}

            <p role="status" className="mt-3 text-sm text-gray-400 empty:hidden">{push.message}</p>
        </div>
    );
}
