import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../api/errors';
import { useParams, Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function ConfirmEmailChange() {
    const { uid, token, new_email } = useParams();
    const { isAuthenticated, refreshProfile } = useAuth();
    const [status, setStatus] = useState('loading'); // loading, success, error
    const [message, setMessage] = useState('Confirming your new email address...');
    // The link is single-use; never submit it twice (StrictMode, auth changes).
    const submittedLink = useRef(null);

    useEffect(() => {
        const linkKey = `${uid}/${token}/${new_email}`;
        if (submittedLink.current === linkKey) return;
        submittedLink.current = linkKey;

        const confirmChange = async () => {
            try {
                // Decode base64 email for display if needed (but API handles token validation)
                await authApi.confirmEmailChange(uid, token, new_email);

                if (isAuthenticated) {
                    try {
                        await refreshProfile();
                    } catch {
                        // The email change succeeded; a stale local profile refresh should not fail the page.
                    }
                }

                setStatus('success');
                setMessage('Your email has been successfully updated!');
            } catch (err) {
                setStatus('error');
                setMessage(getApiErrorMessage(err, 'Invalid or expired confirmation link.'));
            }
        };

        if (uid && token && new_email) {
            confirmChange();
        } else {
            setStatus('error');
            setMessage('Invalid verification link.');
        }
    }, [uid, token, new_email, isAuthenticated, refreshProfile]);

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
            <div className="w-full max-w-md bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl text-center">
                {status === 'loading' && (
                    <div className="flex flex-col items-center">
                        <Loader2 className="w-12 h-12 text-accent animate-spin mb-4" />
                        <h2 className="text-xl font-bold text-white mb-2">Verifying...</h2>
                        <p className="text-gray-400">{message}</p>
                    </div>
                )}

                {status === 'success' && (
                    <div className="flex flex-col items-center animate-fade-in">
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle className="w-8 h-8 text-green-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Email Updated!</h2>
                        <p className="text-gray-400 mb-8">{message}</p>
                        <Link to="/settings" className="btn-primary w-full block">
                            Back to Settings
                        </Link>
                    </div>
                )}

                {status === 'error' && (
                    <div className="flex flex-col items-center animate-fade-in">
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Verification Failed</h2>
                        <p className="text-gray-400 mb-8">{message}</p>
                        <Link to="/settings" className="px-4 py-2 bg-dark-200 hover:bg-dark-300 text-white rounded-lg transition-colors">
                            Return to Settings
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
