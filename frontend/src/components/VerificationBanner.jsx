import { useState } from 'react';
import { AlertCircle, RefreshCw, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';
import logger from '../utils/logger';

export default function VerificationBanner() {
    const { user, isAuthenticated } = useAuth();
    const [isResending, setIsResending] = useState(false);
    const [resendSuccess, setResendSuccess] = useState(false);

    const showVerificationBanner = isAuthenticated && user && user.email_verified === false;

    const handleResendVerification = async () => {
        if (!user?.email) return;
        setIsResending(true);
        try {
            await authApi.resendVerification(user.email);
            setResendSuccess(true);
            setTimeout(() => setResendSuccess(false), 5000);
        } catch (err) {
            logger.error('Failed to resend verification:', err);
        } finally {
            setIsResending(false);
        }
    };

    if (!showVerificationBanner) return null;

    return (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 backdrop-blur-sm relative z-[60]">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-2 text-yellow-500">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>
                        Please verify your email address to access all features.
                        <span className="hidden sm:inline"> Check your inbox for the verification link.</span>
                    </span>
                </div>
                {resendSuccess ? (
                    <div className="flex items-center gap-2 text-green-400 font-medium whitespace-nowrap">
                        <CheckCircle className="w-4 h-4" />
                        <span>Sent!</span>
                    </div>
                ) : (
                    <button
                        onClick={handleResendVerification}
                        disabled={isResending}
                        className="flex items-center gap-2 text-yellow-500 hover:text-yellow-400 font-medium whitespace-nowrap disabled:opacity-50 transition-colors"
                    >
                        {isResending ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                            <RefreshCw className="w-4 h-4" />
                        )}
                        Resend Email
                    </button>
                )}
            </div>
        </div>
    );
}