import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { authApi } from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';

const describeDevices = (count) =>
    count === 1 ? 'Signed in on this device only.' : `Signed in on ${count} devices.`;

const lastActive = (iso) => {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return `Active ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
};

/**
 * Signed-in devices (P1-11, BUG-008): each one with its browser and system,
 * when it was last active, and a Sign out button; this device is marked and
 * signs out with Log out. "Sign out everywhere else" ends all the others.
 * The refresh cookie identifies this device, so it stays signed in.
 */
export default function SessionsCard() {
    const [active, setActive] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [isRevoking, setIsRevoking] = useState(false);
    const [revokingId, setRevokingId] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const response = await authApi.getSessions();
            setActive(response.data.active);
            setSessions(Array.isArray(response.data.sessions) ? response.data.sessions : []);
        } catch {
            setActive(null);
            setSessions([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleRevokeOthers = async () => {
        setIsRevoking(true);
        setError('');
        setMessage('');
        try {
            const response = await authApi.revokeOtherSessions();
            const { revoked } = response.data;
            setActive(response.data.active);
            setSessions((current) => current.filter((session) => session.current));
            setMessage(
                revoked === 1
                    ? 'Signed out 1 other device.'
                    : `Signed out ${revoked} other devices.`,
            );
        } catch (err) {
            setError(getApiErrorMessage(err, 'Could not sign out other devices. Please try again.'));
        } finally {
            setIsRevoking(false);
        }
    };

    const handleRevokeOne = async (session) => {
        setRevokingId(session.id);
        setError('');
        setMessage('');
        try {
            const response = await authApi.revokeSession(session.id);
            setActive(response.data.active);
            setSessions((current) => current.filter((item) => item.id !== session.id));
            setMessage(`Signed out ${session.device}.`);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Could not sign out that device. Please try again.'));
            load();
        } finally {
            setRevokingId(null);
        }
    };

    return (
        <div>
            <p className="text-sm text-[var(--text-2)] mb-3">
                {active === null ? 'Sign out from this device.' : describeDevices(active)}
                {' '}Other devices may stay signed in for up to 15 minutes after being signed out.
            </p>
            {sessions.length > 0 && (
                <ul aria-label="Signed-in devices" className="mb-3 divide-y divide-white/[0.06]">
                    {sessions.map((session) => {
                        const when = lastActive(session.last_active_at);
                        return (
                            <li key={session.id} className="flex items-center justify-between gap-4 py-2.5">
                                <div className="min-w-0">
                                    <p className="truncate text-[15px] text-[var(--text-1)]">
                                        {session.device}
                                        {session.current && (
                                            <span className="ml-2 rounded-md bg-[var(--signature-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--signature)]">
                                                This device
                                            </span>
                                        )}
                                    </p>
                                    {!session.current && when && (
                                        <p className="text-sm text-[var(--text-3)]">{when}</p>
                                    )}
                                </div>
                                {!session.current && (
                                    <button
                                        type="button"
                                        onClick={() => handleRevokeOne(session)}
                                        disabled={revokingId === session.id || isRevoking}
                                        // Starts with the visible text (WCAG 2.5.3), then says which device.
                                        aria-label={`Sign out: ${session.device}${when ? `, ${when.toLowerCase()}` : ''}`}
                                        className="btn-ghost -mr-3 shrink-0 text-sm"
                                    >
                                        {revokingId === session.id ? 'Signing out...' : 'Sign out'}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {active !== null && active > 1 && (
                <button
                    type="button"
                    onClick={handleRevokeOthers}
                    disabled={isRevoking}
                    className="btn-ghost -ml-3 text-sm"
                >
                    {isRevoking ? 'Signing out...' : 'Sign out everywhere else'}
                </button>
            )}
            <div aria-live="polite">
                {message && <p className="text-sm text-[var(--text-2)] mt-3">{message}</p>}
                {error && <p role="alert" className="text-sm text-[var(--danger)] mt-3">{error}</p>}
            </div>
        </div>
    );
}
