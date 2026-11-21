import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, MailX } from 'lucide-react';

import { notificationApi } from '../api/modules/notifications';
import SEO from '../components/SEO';
import logger from '../utils/logger';

const SETTINGS_LINK = '/settings?tab=notifications';

const errorCopy = (error) => {
    const status = error?.response?.status;
    if (status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (status === 400) return 'This unsubscribe link isn’t valid any more. You can turn episode emails off in Settings.';
    return 'Something went wrong. Check your connection and try again.';
};

/**
 * Landing page for the unsubscribe link in episode emails
 * (`/notifications/unsubscribe?token=…`). Opening the link changes nothing
 * (mail scanners prefetch links); the button sends the one POST. Works signed
 * out: the signed token is the credential.
 */
export default function NotificationPreferences() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || '';
    const [status, setStatus] = useState('idle'); // idle | working | done | error
    const [error, setError] = useState('');

    const handleUnsubscribe = async () => {
        if (!token || status === 'working') return;
        setStatus('working');
        setError('');
        try {
            await notificationApi.emailUnsubscribe(token);
            setStatus('done');
        } catch (requestError) {
            logger.warn('Email unsubscribe failed:', requestError);
            setError(errorCopy(requestError));
            setStatus('error');
        }
    };

    let body;
    if (!token) {
        body = (
            <p className="text-sm leading-relaxed text-gray-400">
                This link is missing its unsubscribe code. You can turn episode emails off in Settings.
            </p>
        );
    } else if (status === 'done') {
        body = (
            <p className="text-sm leading-relaxed text-gray-400">
                You won’t get episode emails any more. In-app and push notifications are unchanged.
            </p>
        );
    } else {
        body = (
            <>
                <p className="text-sm leading-relaxed text-gray-400">
                    Stop the emails AniShows sends when a new episode of a show you’re watching airs.
                </p>
                <button
                    type="button"
                    onClick={handleUnsubscribe}
                    disabled={status === 'working'}
                    className="btn-primary mt-6"
                >
                    {status === 'working' && <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />}
                    Unsubscribe from episode emails
                </button>
            </>
        );
    }

    return (
        <div className="max-w-md mx-auto px-4 py-12 sm:py-16">
            <SEO page="notifications" noIndex />
            <div className="rounded-2xl border border-gray-800 bg-dark-100 p-6 sm:p-8 text-center">
                <MailX aria-hidden="true" className="w-10 h-10 mx-auto text-gray-500 mb-4" />
                <h1 className="text-2xl font-semibold text-white mb-3">
                    {status === 'done' ? 'Unsubscribed' : 'Episode emails'}
                </h1>
                {body}
                <p role="status" className="mt-4 text-sm text-red-400 empty:hidden">{error}</p>
                <p className="mt-6 text-sm">
                    <Link to={SETTINGS_LINK} className="text-accent hover:text-accent/80 transition-colors">
                        Manage notifications
                    </Link>
                </p>
            </div>
        </div>
    );
}
