import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function VerifyEmail() {
    const { uid, token } = useParams();
    const [status, setStatus] = useState('loading'); // loading, success, error
    const [message, setMessage] = useState('');

    useEffect(() => {
        const verify = async () => {
            try {
                await authApi.verifyEmail({ uid, token });
                setStatus('success');
            } catch (err) {
                setStatus('error');
                setMessage(err.response?.data?.error || 'Verification failed');
            }
        };

        if (uid && token) {
            verify();
        }
    }, [uid, token]);

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md bg-dark-100 rounded-2xl p-8 border border-gray-800 shadow-xl text-center">
                {status === 'loading' && (
                    <>
                        <Loader2 className="w-16 h-16 text-accent animate-spin mx-auto mb-6" />
                        <h2 className="text-2xl font-bold text-white mb-2">Verifying Email...</h2>
                        <p className="text-gray-400">Please wait while we verify your account.</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-8 h-8 text-green-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Email Verified!</h2>
                        <p className="text-gray-400 mb-8">Your account has been successfully verified. You can now log in.</p>
                        <Link to="/login" className="btn-primary w-full block">
                            Go to Login
                        </Link>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <XCircle className="w-8 h-8 text-red-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Verification Failed</h2>
                        <p className="text-gray-400 mb-8">{message}</p>
                        <Link to="/login" className="text-accent hover:text-accent-hover font-medium">
                            Return to Login
                        </Link>
                    </>
                )}
            </div>
        </div>
    );
}
