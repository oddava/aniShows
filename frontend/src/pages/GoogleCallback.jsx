import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import logger from '../utils/logger';

const GOOGLE_OAUTH_STATE_KEY = 'google_oauth_state';

export default function GoogleCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { startSession } = useAuth();
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const processedRef = useRef(false);

    const handleGoogleCallback = useCallback(async (code) => {
        try {
            const callbackUrl = `${window.location.origin}/auth/google/callback`;
            const response = await authApi.googleLogin(code, callbackUrl);
            const { access } = response.data;

            await startSession(access);
            navigate('/browse');
        } catch (err) {
            logger.error('Google login failed:', err);
            const msg = err.response?.data?.non_field_errors?.[0]
                || err.response?.data?.detail
                || 'Failed to log in with Google. Please try again.';
            setIsLoading(false);
            setError(msg);
            setTimeout(() => navigate('/login'), 3000);
        }
    }, [navigate, startSession]);

    useEffect(() => {
        if (processedRef.current) return;
        processedRef.current = true;

        const code = searchParams.get('code');
        const errorParam = searchParams.get('error');
        const state = searchParams.get('state');
        const expectedState = sessionStorage.getItem(GOOGLE_OAUTH_STATE_KEY);
        sessionStorage.removeItem(GOOGLE_OAUTH_STATE_KEY);

        if (errorParam) {
            setIsLoading(false);
            setError(`Google login cancelled: ${errorParam}`);
            setTimeout(() => navigate('/login'), 3000);
        } else if (!state || !expectedState || state !== expectedState) {
            setIsLoading(false);
            setError('Google login session expired. Please try again.');
            setTimeout(() => navigate('/login'), 3000);
        } else if (code) {
            handleGoogleCallback(code);
        } else {
            setIsLoading(false);
            setError('No authorization code found');
            setTimeout(() => navigate('/login'), 3000);
        }
    }, [searchParams, navigate, handleGoogleCallback]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-dark-200">
            <div className="bg-dark-100 p-8 rounded-2xl border border-gray-800 text-center max-w-md w-full">
                {!isLoading && error ? (
                    <>
                        <div className="text-red-500 text-xl font-bold mb-4">Error</div>
                        <p className="text-gray-400">{error}</p>
                        <p className="text-gray-500 text-sm mt-2">Redirecting to login...</p>
                    </>
                ) : (
                    <>
                        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                        <h2 className="text-2xl font-bold text-white mb-2">Authenticating...</h2>
                        <p className="text-gray-400">Please wait while we verify your Google account.</p>
                    </>
                )}
            </div>
        </div>
    );
}
