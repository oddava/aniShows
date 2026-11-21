import React from 'react';

export default function MaintenanceScreen({ message, onRetry, checkingStatus }) {
    return (
        <main className="min-h-screen bg-[#050507] text-white flex items-center justify-center px-4 sm:px-6">
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] p-8 md:p-12">
                <p className="text-xs text-white/50 mb-4">
                    Scheduled Maintenance
                </p>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                    We&apos;ll be back shortly.
                </h1>
                <p className="text-white/70 text-base md:text-lg leading-relaxed">
                    {message || 'The service is temporarily unavailable due to maintenance. Please try again later.'}
                </p>

                <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
                    <button
                        type="button"
                        onClick={onRetry}
                        disabled={checkingStatus}
                        className="px-5 py-2.5 min-h-[44px] rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-violet-700 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
                    >
                        {checkingStatus ? 'Checking...' : 'Try again'}
                    </button>
                    <span className="text-sm text-white/45">
                        We automatically retry in the background.
                    </span>
                </div>
            </div>
        </main>
    );
}
