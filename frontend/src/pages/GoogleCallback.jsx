import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../context/AuthContext';
import { GOOGLE_CALLBACK_PATH, consumeGoogleSignInState } from '../components/auth/googleSignIn';
import logger from '../utils/logger';

const EXISTING_EMAIL_MESSAGE =
    'This email already has an aniShows account with a password. Sign in with your email and password instead.';

function describeGoogleError(err) {
    const detail = getApiErrorMessage(err, '');
    if (/already registered/i.test(detail)) return EXISTING_EMAIL_MESSAGE;
    return detail || 'Failed to sign in with Google. Please try again.';
}

export default function GoogleCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { startSession } = useAuth();
    const [error, setError] = useState('');
    const processedRef = useRef(false);

    const handleGoogleCallback = useCallback(async (code, returnTo) => {
        try {
            const callbackUrl = `${window.location.origin}${GOOGLE_CALLBACK_PATH}`;
            const response = await authApi.googleLogin(code, callbackUrl);
            await startSession(response.data.access);
            navigate(returnTo, { replace: true });
        } catch (err) {
            logger.error('Google login failed:', err);
            setError(describeGoogleError(err));
        }
    }, [navigate, startSession]);

    useEffect(() => {
        if (processedRef.current) return;
        processedRef.current = true;

        const code = searchParams.get('code');
        const errorParam = searchParams.get('error');
        const { valid, returnTo } = consumeGoogleSignInState(searchParams.get('state'));

        if (errorParam === 'access_denied') {
            setError('Google sign-in was cancelled. You can try again whenever you like.');
        } else if (errorParam) {
            setError('Google could not complete the sign-in. Please try again.');
        } else if (!valid) {
            setError('This Google sign-in has expired. Please start again.');
        } else if (code) {
            handleGoogleCallback(code, returnTo);
        } else {
            setError('Google did not send an authorization code. Please try again.');
        }
    }, [searchParams, handleGoogleCallback]);

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md bg-dark-100 rounded-2xl p-6 sm:p-8 border border-gray-800 shadow-xl text-center">
                {error ? (
                    <>
                        <h1 className="text-xl font-bold text-white mb-3">Couldn't sign in with Google</h1>
                        <p role="alert" className="text-gray-400 mb-6">{error}</p>
                        <Link to="/login" className="btn-primary inline-flex justify-center w-full sm:w-auto">
                            Back to sign in
                        </Link>
                    </>
                ) : (
                    <div role="status">
                        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                        <h1 className="text-2xl font-bold text-white mb-2">Signing you in...</h1>
                        <p className="text-gray-400">Please wait while we verify your Google account.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
