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
            <p className="text-gray-400 text-sm mb-3">
                {active === null ? 'Sign out from this device.' : describeDevices(active)}
                {' '}Other devices may stay signed in for up to 15 minutes after being signed out.
            </p>
            {active !== null && active > 1 && (
                <button
                    type="button"
                    onClick={handleRevokeOthers}
                    disabled={isRevoking}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-dark-50 hover:bg-dark-200 text-gray-300 border border-gray-700 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
                >
                    {isRevoking ? 'Signing out...' : 'Sign out everywhere else'}
                </button>
            )}
            <div aria-live="polite">
                {message && <p className="text-green-400 text-sm mt-3">{message}</p>}
                {error && <p role="alert" className="text-red-400 text-sm mt-3">{error}</p>}
            </div>
        </div>
    );
}
