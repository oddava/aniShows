import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

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
            <p className="text-[15px] leading-relaxed text-[var(--text-2)]">
                This link is missing its unsubscribe code. You can turn episode emails off in Settings.
            </p>
        );
    } else if (status === 'done') {
        body = (
            <p className="text-[15px] leading-relaxed text-[var(--text-2)]">
                You won’t get episode emails any more. In-app and push notifications are unchanged.
            </p>
        );
    } else {
        body = (
            <>
                <p className="text-[15px] leading-relaxed text-[var(--text-2)]">
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
        <div className="page-container pt-6 pb-16 md:pt-10">
            <SEO page="notifications" noIndex />
            <h1 className="page-title">
                {status === 'done' ? 'Unsubscribed' : 'Episode emails'}
            </h1>
            <div className="mt-6 max-w-xl">
                {body}
                <p role="status" className="mt-4 text-sm text-[var(--danger)] empty:hidden">{error}</p>
                <Link to={SETTINGS_LINK} className="text-link mt-4">
                    Manage notifications
                </Link>
            </div>
        </div>
    );
}
