import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../context/AuthContext';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import logger from '../utils/logger';
import useTokenLinkParams from '../components/auth/useTokenLinkParams';

export default function VerifyEmail() {
    // The token moves out of the address bar before anything else runs (A14).
    const { linkParams, isRedirecting } = useTokenLinkParams(['uid', 'token'], '/verify-email');
    const uid = linkParams?.uid;
    const token = linkParams?.token;
    const navigate = useNavigate();
    const { startSession } = useAuth();
    const [status, setStatus] = useState('loading'); // loading, success, already_verified, error
    const [message, setMessage] = useState('');
    // The token is single-use: StrictMode's double effect must not send it twice.
    const requestedLink = useRef(null);

    useEffect(() => {
        if (isRedirecting) return;
        if (!uid || !token) {
            setStatus('error');
            setMessage('This verification link is incomplete. Open it again from the email.');
            return;
        }
        const link = `${uid}/${token}`;
        if (requestedLink.current === link) return;
        requestedLink.current = link;

        const verify = async () => {
            try {
                const response = await authApi.verifyEmail(uid, token);
                logger.log("VerifyEmail: API success", response.data);

                // If backend returns tokens, auto-login
                if (response.data.access) {
                    logger.log("VerifyEmail: Tokens received, calling startSession");
                    // Pass tokens and user data to update email_verified status
                    await startSession(response.data.access, response.data.user);

                    // Redirect after a short delay so they can see the success message
                    setTimeout(() => {
                        logger.log("VerifyEmail: Redirecting to /browse");
                        navigate('/browse');
                    }, 2000);
                } else if (response.data.already_verified) {
                    setStatus('already_verified');
                    return;
                } else {
                    logger.warn("VerifyEmail: No tokens in response", response.data);
                }

                setStatus('success');
            } catch (err) {
                setStatus('error');
                setMessage(getApiErrorMessage(err, 'Verification failed'));
            }
        };

        verify();
    }, [uid, token, isRedirecting, startSession, navigate]);

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
                        <p className="text-gray-400 mb-8">Your account has been successfully verified. Redirecting you...</p>
                        <Link to="/browse" className="btn-primary w-full block">
                            Start Browsing
                        </Link>
                    </>
                )}

                {status === 'already_verified' && (
                    <>
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-8 h-8 text-green-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Already Verified</h2>
                        <p className="text-gray-400 mb-8">Your email is already verified. Log in to continue.</p>
                        <Link to="/login" className="btn-primary w-full block">
                            Log In
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
