import { useCallback, useEffect, useState } from 'react';
import { authApi } from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';

const describeDevices = (count) =>
    count === 1 ? 'Signed in on this device only.' : `Signed in on ${count} devices.`;

/**
 * "Signed in on N devices · Sign out everywhere else" (P1-11). The refresh
 * cookie identifies this device, so it stays signed in.
 */
export default function SessionsCard() {
    const [active, setActive] = useState(null);
    const [isRevoking, setIsRevoking] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const response = await authApi.getSessions();
            setActive(response.data.active);
        } catch {
            setActive(null);
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

    return (
        <div>
            <p className="text-sm text-[var(--text-2)] mb-3">
                {active === null ? 'Sign out from this device.' : describeDevices(active)}
                {' '}Other devices may stay signed in for up to 15 minutes after being signed out.
            </p>
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
